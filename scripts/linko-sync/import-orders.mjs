// Продажи → Заказы: brings the orders of the Linko account in line with it — status, the warehouse the goods leave
// (orders.warehouse, read by the stock ledger: "Есть на складе" / "Не подтвержден" reserve, "В пути" / "Доставлено"
// ship), the ship moment (shipped_at: when Linko's stock let the goods out, see below), the client (the shop: Linko's
// market), whether Linko
// debited the client (orders.no_debt), the product lines (order_items: price before the line discount + the discount)
// and the history (order_logs).
// Orders themselves (928, same ids) were imported earlier; the fields above are what the stock and the history need,
// with the card's organization, payment type and term, currency, author, comment, invoice and accepted day.
//
// A history row's payment type is Linko's key ("cash"): it is stored under the name the account's orders give that key,
// its shop (a Linko market id) under the shop's name; rows imported earlier without them get them once.
//
//   node scripts/linko-sync/import-orders.mjs   (raw: orders, orders_detail, order_products, order_logs,
//                                                barcode_history and markets when downloaded)
import fs from "node:fs"
import path from "node:path"

import { connect, currencyCode, ensureRegistry, fullName, hasRaw, raw, rawDir, register, runId, upsertById, utcIso } from "./lib.mjs"

const STATUS = { 0: "В процессе", 1: "Есть на складе", 2: "В пути", 3: "Доставлено", 4: "Отменен", 5: "Не подтвержден" }
const SHIPPED = new Set(["2", "3"])

const list = raw("orders")
const details = raw("orders_detail")
const lines = raw("order_products")
const logs = raw("order_logs")
// Linko's client ledger: the debit it booked per order (client transactions of type 4).
const debited = new Set(raw("client_transactions").filter((t) => t.type === 4 && t.order).map((t) => t.order))
const run = runId("orders")

const client = await connect()
await ensureRegistry(client)
const stats = { orders: { insert: 0, update: 0, same: 0 }, missingOrders: [], lineFixes: 0, linesInserted: 0, logs: 0, logsFilled: 0 }
try {
  await client.query("BEGIN")
  // The moment the goods left the warehouse: Linko's own stock-out of the order (its stock history, barcode_history: the
  // first "Out" row of the order), which is the order's accepted_time. A status set to В пути / Доставлено later (or
  // back-dated orders accepted long before) does not move it. Without that history: the accepted moment, then the
  // first time Linko's order history shows the order handed over / delivered.
  const stockOut = new Map()
  if (hasRaw("barcode_history")) {
    const history = raw("barcode_history")
    for (const row of Array.isArray(history) ? history : Object.values(history)) {
      if (row?.type !== "Out" || row.generic?.type !== "order" || !row.created_date) continue
      const id = row.d_order_number_id ?? row.d_parent_id
      if (id != null && (!stockOut.has(id) || row.created_date < stockOut.get(id))) stockOut.set(id, row.created_date)
    }
  }
  const shippedAt = new Map()
  for (const log of [...logs].sort((a, b) => a.id - b.id)) {
    const id = typeof log.order === "object" ? log.order?.id : log.order
    if (SHIPPED.has(String(log.status)) && !shippedAt.has(id)) shippedAt.set(id, log.created_date)
  }
  await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS linko_remaining DOUBLE PRECISION")
  // Payments linked to an order after this moment reduce Linko's remainder (lib/finance-order-debts.ts): the moment the
  // orders were downloaded (UTC, the raw file's own timestamp; Linko's remainders are as of then), so a re-run of the
  // same download keeps it. A file without that timestamp takes the import moment, as before.
  await client.query("CREATE TABLE IF NOT EXISTS linko_history (ledger TEXT PRIMARY KEY, until TEXT NOT NULL)")
  const fetched = String(JSON.parse(fs.readFileSync(path.join(rawDir(), "orders.json"), "utf8")).fetched ?? "").replace("T", " ").slice(0, 19)
  const until = fetched || (await client.query("SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS now")).rows[0].now
  const untilBefore = (await client.query("SELECT until FROM linko_history WHERE ledger = 'order_debts'")).rows[0]?.until ?? null
  if (untilBefore !== until) {
    await client.query("INSERT INTO linko_history (ledger, until) VALUES ('order_debts', $1) ON CONFLICT (ledger) DO UPDATE SET until = EXCLUDED.until", [until])
    await register(client, run, "linko_history", "order_debts", untilBefore === null ? "insert" : "update", untilBefore === null ? null : { until: untilBefore })
  }
  const known = new Set((await client.query("SELECT id FROM orders")).rows.map((r) => r.id))
  for (const row of list) {
    if (!known.has(row.id)) {
      stats.missingOrders.push(row.id)
      continue
    }
    const doc = details[row.id] ?? {}
    const status = STATUS[Number(row.status)] ?? STATUS[Number(doc.status)]
    const stock = doc.stock?.name ?? ""
    const shipped = SHIPPED.has(String(row.status))
      ? utcIso(stockOut.get(row.id) ?? doc.accepted_time ?? row.accepted_time ?? shippedAt.get(row.id) ?? row.created_date)
      : null
    stats.orders[
      await upsertById(client, run, "orders", row.id, {
        status,
        warehouse: stock,
        stock_name: stock,
        shipped_at: shipped,
        // The order's client is its shop (Linko market = clients.id); the account stays in the `client` text.
        client_id: row.market?.id ?? doc.market?.id ?? null,
        // Linko booked no client debt for this order: the client ledger leaves it out too.
        no_debt: debited.has(row.id) ? 0 : 1,
        // The order card's fields and the ledger's Организация / Тип оплаты (the client act per organization, the
        // cash / bank split of Сверка): Linko's division, payment type and term, currency, author, comment, invoice.
        organization: row.division?.name ?? doc.division?.name ?? "",
        payment_type: row.payment_type === "bank" ? "bank" : "cash",
        payment_date: row.payment_date ?? doc.payment_date ?? "",
        currency: currencyCode(row.currency ?? doc.currency),
        created_by: fullName(row.user ?? doc.user),
        comment: row.comment ?? doc.comment ?? "",
        invoice_number: row.invoice_number ?? "",
        invoice_date: row.invoice_date ?? "",
        invoice_active: row.invoice_is_active ? 1 : 0,
        // «Долги с заказов»: what Linko still counts unpaid on the order (its own allocation of the payments).
        linko_remaining: Number(row.total_balance) || 0,
        // The day Linko accepted the order (its accepted_time, local): «Дата реализации» and the age of a debt.
        accepted_date: String(doc.accepted_time ?? row.accepted_time ?? "").slice(0, 10),
      })
    ]++
  }

  // Lines: exact quantities and prices of Linko (the earlier copy rounded some prices), missing lines added.
  const byOrder = new Map()
  for (const line of lines) {
    if (!byOrder.has(line.order_id)) byOrder.set(line.order_id, [])
    byOrder.get(line.order_id).push(line)
  }
  // A discounted line: Linko's price is after the discount (origin_price × (1 − discount_percent)); here the line keeps
  // the price before the discount and the discount, so price × quantity × (1 − discount) = Linko's line total.
  const pricing = new Map()
  for (const doc of Object.values(details)) {
    for (const p of doc.products ?? []) {
      const price = Number(p.price) || 0
      const origin = Number(p.origin_price) || 0
      const discount = Number(p.discount_percent) || 0
      const consistent = origin > 0 && discount > 0 && Math.abs(origin * (1 - discount / 100) - price) < 0.01
      pricing.set(p.id, consistent ? { price: origin, discount } : { price, discount: 0 })
    }
  }
  for (const [orderId, want] of byOrder) {
    if (!known.has(orderId)) continue
    const have = (await client.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [orderId])).rows
    const used = new Set()
    for (const line of want.sort((a, b) => a.id - b.id)) {
      const qty = Number(line.amount)
      const { price, discount } = pricing.get(line.id) ?? { price: Number(line.price), discount: 0 }
      const match =
        have.find((h) => !used.has(h.id) && h.product_id === line.product_id && Math.abs(h.quantity - qty) < 1e-6) ??
        have.find((h) => !used.has(h.id) && h.product_id === line.product_id)
      if (match) {
        used.add(match.id)
        const patch = {}
        if (Math.abs(match.unit_price - price) > 1e-9) patch.unit_price = price
        if (Math.abs((match.discount_percent ?? 0) - discount) > 1e-9) patch.discount_percent = discount
        if (Math.abs(match.quantity - qty) > 1e-9) patch.quantity = qty
        const ret = Number(line.return_amount) || 0
        if (Math.abs((match.return_quantity ?? 0) - ret) > 1e-9) patch.return_quantity = ret
        if (Object.keys(patch).length) {
          const cols = Object.keys(patch)
          await client.query(`UPDATE order_items SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`, [match.id, ...cols.map((c) => patch[c])])
          await register(client, run, "order_items", match.id, "update", Object.fromEntries(cols.map((c) => [c, match[c]])))
          stats.lineFixes++
        }
      } else {
        const order = details[orderId] ?? {}
        const inserted = await client.query(
          `INSERT INTO order_items (order_id, product_id, product_name, unit, quantity, unit_price, cost_price, discount_percent, currency, created_at, return_quantity)
           VALUES ($1, $2, $3, $4, $5, $6, 0, $10, $7, $8, $9) RETURNING id`,
          [orderId, line.product_id, line.product_name ?? "", line.measurement?.name ?? "", qty, price, currencyCode(order.currency), String(line.order_created_date ?? order.created_date ?? "").replace("T", " ").slice(0, 19), Number(line.return_amount) || 0, discount],
        )
        await register(client, run, "order_items", inserted.rows[0].id, "insert")
        stats.linesInserted++
      }
    }
  }

  // History rows Linko has and this copy does not (order_logs.ref_id = Linko's history id).
  // Payment type: Linko gives the row's custom payment type as its key ("cash") — or as {key, name} — and the name is
  // the one the orders of the account show for that key (the row's own order first, else the name most orders use).
  // The shop: Linko's market id (or {id, name}) → the shop's name (markets, else the copy's clients).
  const typeNames = new Map()
  const orderType = new Map()
  for (const order of [...list, ...Object.values(details)]) {
    const type = order?.custom_payment_type
    if (!type?.key || !type.name) continue
    if (!orderType.has(order.id)) orderType.set(order.id, type)
    const counts = typeNames.get(type.key) ?? new Map()
    counts.set(type.name, (counts.get(type.name) ?? 0) + 1)
    typeNames.set(type.key, counts)
  }
  const commonName = (key) => [...(typeNames.get(key) ?? new Map()).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ""
  const payTypeOf = (log, orderId) => {
    const value = log.custom_payment_type
    if (value && typeof value === "object") return String(value.name ?? "")
    if (!value) return ""
    const own = orderType.get(orderId)
    return own?.key === value ? own.name : commonName(value)
  }
  const shopNames = new Map((await client.query("SELECT id, name FROM clients")).rows.map((r) => [Number(r.id), r.name ?? ""]))
  if (hasRaw("markets")) for (const market of raw("markets")) if (market?.id != null && market.name) shopNames.set(Number(market.id), market.name)
  const shopOf = (log) => {
    const market = log.market
    if (market && typeof market === "object") return String(market.name ?? shopNames.get(Number(market.id)) ?? "")
    return market == null ? "" : (shopNames.get(Number(market)) ?? "")
  }
  const haveLogs = new Map(
    (await client.query("SELECT id, ref_id, pay_type_name, market_name FROM order_logs WHERE ref_id IS NOT NULL")).rows.map((r) => [Number(r.ref_id), r]),
  )
  for (const log of logs) {
    const orderId = typeof log.order === "object" ? log.order?.id : log.order
    const payType = payTypeOf(log, orderId)
    const shop = shopOf(log)
    const have = haveLogs.get(Number(log.id))
    if (have) {
      // A row imported before the payment type / shop were read gets them once (a name already stored stays).
      const patch = {}
      if (!have.pay_type_name && payType) patch.pay_type_name = payType
      if (!have.market_name && shop) patch.market_name = shop
      const cols = Object.keys(patch)
      if (cols.length) {
        await client.query(`UPDATE order_logs SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")} WHERE id = $1`, [have.id, ...cols.map((c) => patch[c])])
        await register(client, run, "order_logs", have.id, "update", Object.fromEntries(cols.map((c) => [c, have[c]])))
        stats.logsFilled++
      }
      continue
    }
    if (!known.has(orderId)) continue
    const inserted = await client.query(
      `INSERT INTO order_logs (ref_id, order_id, action, status, comment, total_price, currency, pay_type_name, created_by, created_at, market_name, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '[]') RETURNING id`,
      [log.id, orderId, log.action ?? "", String(log.status ?? ""), log.comment ?? "", Number(log.total_price) || 0, currencyCode(log.currency), payType, fullName(log.created_by), String(log.created_date ?? "").slice(0, 19), shop],
    )
    await register(client, run, "order_logs", inserted.rows[0].id, "insert")
    stats.logs++
  }
  await client.query("COMMIT")
  console.log(JSON.stringify(stats))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
