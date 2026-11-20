// Продажи → Заказы → card → «Оплачено» → «Список оплат по заказу»: Linko lists the order's debt transactions
// (sales/debt_transactions/?order=<id>): every credit (a payment, a client return, a correction…) that paid a part of the
// order, with the share it paid. Raw file order_debt_transactions.json: { tpl, data: { orderId: [rows] } } from fetch
// step order-debt-transactions or a read-only capture of the cards' payment lists.
// Each copied order gets Linko's list as it is shown (orders.linko_payment_lines, JSON, in Linko's order; [] = Linko has
// none, NULL = not copied: the app lists its own payments). Payments made in the app after the copy are added by
// lib/orders-repo.ts listOrderPayments. Every change is registered in linko_sync_rows (previous value).
//
//   node scripts/linko-sync/import-order-payment-lines.mjs        (RAW=<folder> picks the raw folder)
import fs from "node:fs"
import path from "node:path"

import { ROOT, connect, currencyCode, ensureRegistry, fullName, register, runId } from "./lib.mjs"

const FILE = "order_debt_transactions.json"

function rawFile() {
  if (process.env.RAW) return path.join(process.env.RAW, FILE)
  const base = path.join(ROOT, "backups", "linko-raw")
  const days = fs.existsSync(base) ? fs.readdirSync(base).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse() : []
  const day = days.find((name) => fs.existsSync(path.join(base, name, FILE)))
  return day ? path.join(base, day, FILE) : null
}

const file = rawFile()
if (!file || !fs.existsSync(file)) {
  console.log(`order payment lines: no raw ${FILE} (run fetch.mjs order-debt-transactions or capture the cards first)`)
  process.exit(0)
}
const parsed = JSON.parse(fs.readFileSync(file, "utf8"))
const lists = parsed.data ?? parsed

const number = (value) => (value == null || value === "" ? null : Number(value))
const id = (value) => (value && typeof value === "object" ? number(value.id) : number(value))

/** One debt transaction as the card's list prints it (components/orders/order-returns-tab.tsx). */
function line(row) {
  const from = row.from_transaction ?? {}
  const to = row.to_transaction ?? {}
  return {
    id: Number(row.id),
    type: Number(from.type) || 0,
    transaction: number(from.transaction),
    orderReturn: id(from.order_return),
    order: id(from.order),
    // Tashkent wall-clock time, as Linko sends it.
    date: String(from.created_date ?? "").slice(0, 19),
    client: String(from.client?.name ?? ""),
    user: fullName(from.user),
    comment: String(from.comment ?? "").trim(),
    amount: Number(from.amount) || 0,
    currency: currencyCode(from.currency),
    internal: Number(from.internal) || 0,
    rate: number(from.custom_rate),
    fromAmount: Number(row.from_amount) || 0,
    toAmount: Number(row.to_amount) || 0,
    toCurrency: currencyCode(to.currency),
  }
}

const run = runId("order-payment-lines")
const stats = { orders: 0, lines: 0, set: 0, same: 0, missing: [], failed: [] }
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  // Same column as lib/orders-repo.ts ORDER_COLUMNS (a fresh database gets it from either).
  await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS linko_payment_lines TEXT")
  for (const [key, rows] of Object.entries(lists)) {
    const orderId = Number(key)
    if (!Array.isArray(rows)) {
      stats.failed.push(key)
      continue
    }
    const current = (await client.query("SELECT linko_payment_lines FROM orders WHERE id = $1", [orderId])).rows[0]
    if (!current) {
      stats.missing.push(key)
      continue
    }
    stats.orders++
    stats.lines += rows.length
    const value = JSON.stringify(rows.map(line))
    if (current.linko_payment_lines === value) {
      stats.same++
      continue
    }
    await client.query("UPDATE orders SET linko_payment_lines = $2 WHERE id = $1", [orderId, value])
    await register(client, run, "orders", orderId, "update", { linko_payment_lines: current.linko_payment_lines })
    stats.set++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(
  `order payment lines (${path.relative(ROOT, file)}): ${stats.orders} orders, ${stats.lines} lines; ${stats.set} set, ${stats.same} unchanged; ` +
    `orders not here: ${stats.missing.join(",") || "none"}; Linko failed: ${stats.failed.join(",") || "none"}`,
)
