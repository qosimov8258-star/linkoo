// Продажи → Возвраты: every client return of the Linko account (accepted, pending and cancelled) with its products,
// into client_returns / client_return_items (the tables the returns page, the stock ledger and the client ledger read).
// An accepted return adds its goods to its warehouse; the client is credited what Linko credited (client_credit).
//
//   node scripts/linko-sync/import-returns.mjs        (raw files: order_returns, order_returns_detail, order_products)
import { bumpSequence, connect, currencyCode, ensureRegistry, fullName, raw, register, runId, sqlDateTime, upsertById, utcIso } from "./lib.mjs"

const STATUS = { 0: "pending", 1: "pending", 2: "accepted", 3: "cancelled" }

const list = raw("order_returns")
const details = raw("order_returns_detail")
// Linko's client ledger: what it credited per return and currency (client transactions of type 3), also for returns
// still pending. A return can credit in two currencies (a line priced in another one).
const credits = new Map()
const creditPayment = new Map()
for (const t of raw("client_transactions")) {
  if (t.type !== 3 || !t.order_return) continue
  const id = t.order_return?.id ?? t.order_return
  if (t.payment_type === "bank" || t.payment_type === "cash") creditPayment.set(id, t.payment_type)
  const byCurrency = credits.get(id) ?? new Map()
  const code = currencyCode(t.currency)
  byCurrency.set(code, (byCurrency.get(code) ?? 0) + Number(t.amount))
  credits.set(id, byCurrency)
}
const round9 = (value) => Math.round(value * 1e9) / 1e9
/** The credit in the return's own currency, and the credits in other currencies ({"USD": 0.0091}) or null. */
function creditOf(id, currency) {
  const byCurrency = credits.get(id) ?? new Map()
  const other = Object.fromEntries([...byCurrency].filter(([code, amount]) => code !== currency && Math.abs(amount) > 1e-9).map(([code, amount]) => [code, round9(amount)]))
  return { main: round9(byCurrency.get(currency) ?? 0), other: Object.keys(other).length ? JSON.stringify(other) : null }
}
const run = runId("returns")

const client = await connect()
await ensureRegistry(client)
const stats = { insert: 0, update: 0, same: 0, items: 0 }
try {
  await client.query("BEGIN")
  await client.query("ALTER TABLE client_returns ADD COLUMN IF NOT EXISTS client_credit DOUBLE PRECISION, ADD COLUMN IF NOT EXISTS client_credit_other TEXT, ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT ''")
  // Local order line of (order, product): returns point at their order line, kept by the order module.
  const lines = (await client.query("SELECT id, order_id, product_id, quantity FROM order_items")).rows
  const lineOf = new Map()
  for (const line of lines) {
    const key = `${line.order_id}:${line.product_id}`
    if (!lineOf.has(key)) lineOf.set(key, line.id)
  }
  for (const row of list) {
    const detail = details[row.id]
    if (!detail || detail.__status) throw new Error(`return ${row.id}: detail missing (${detail?.__status})`)
    const status = STATUS[Number(row.status)] ?? "pending"
    const created = sqlDateTime(row.created_date)
    const acceptedAt = status === "accepted" ? utcIso(row.accepted_time ?? detail.accepted_time ?? row.created_date) : null
    const credit = creditOf(row.id, currencyCode(row.currency))
    const values = {
      client_id: row.market?.id ?? row.client?.id ?? null,
      client: row.market?.name ?? row.client?.name ?? "",
      warehouse: row.stock?.name ?? detail.stock?.name ?? "",
      order_id: detail.order ?? null,
      return_date: created,
      status,
      currency: currencyCode(row.currency),
      amount: Number(row.total_price) || 0,
      comment: row.comment ?? detail.comment ?? "",
      created_by: fullName(row.created_by),
      created_at: created,
      accepted_at: acceptedAt,
      accepted_by: status === "accepted" ? fullName(row.accepted_by ?? detail.accepted_by) || fullName(row.created_by) : "",
      deliverer: fullName(row.delivery_man ?? detail.delivery_man),
      agent: fullName(row.responsible_agent ?? detail.responsible_agent),
      organization: row.division?.name ?? detail.division_name ?? "",
      cancelled_at: status === "cancelled" ? created : null,
      cancelled_by: status === "cancelled" ? fullName(row.created_by) : "",
      client_credit: credit.main,
      client_credit_other: credit.other,
      payment_type: creditPayment.get(row.id) ?? "",
    }
    stats[await upsertById(client, run, "client_returns", row.id, values)]++

    // Lines: replaced as a whole (they have no id of their own here).
    const wanted = (detail.returned_products ?? []).map((p) => ({
      product_id: p.product?.id ?? null,
      product_name: p.product?.name ?? "",
      unit: p.product?.measurement?.name ?? "",
      quantity: Number(p.amount) || 0,
      price: Number(p.price) || 0,
      order_item_id: lineOf.get(`${p.order ?? detail.order}:${p.product?.id}`) ?? null,
    }))
    const have = (await client.query("SELECT product_id, product_name, unit, quantity, price, order_item_id FROM client_return_items WHERE return_id = $1 ORDER BY id", [row.id])).rows
    const same = have.length === wanted.length && have.every((h, i) => h.product_id === wanted[i].product_id && Math.abs(h.quantity - wanted[i].quantity) < 1e-9 && Math.abs(h.price - wanted[i].price) < 1e-9 && h.product_name === wanted[i].product_name && h.unit === wanted[i].unit && h.order_item_id === wanted[i].order_item_id)
    if (!same) {
      await client.query("DELETE FROM client_return_items WHERE return_id = $1", [row.id])
      for (const item of wanted) {
        await client.query(
          "INSERT INTO client_return_items (return_id, product_id, product_name, unit, quantity, price, order_item_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [row.id, item.product_id, item.product_name, item.unit, item.quantity, item.price, item.order_item_id],
        )
        stats.items++
      }
      await register(client, run, "client_return_items", `return:${row.id}`, "replace", have)
    }
  }
  // Returns that are not in Linko (none expected): reported, not deleted.
  const ids = list.map((row) => row.id)
  const extra = (await client.query("SELECT id FROM client_returns WHERE NOT (id = ANY($1::int[]))", [ids])).rows.map((r) => r.id)
  await bumpSequence(client, "client_returns")
  await client.query("COMMIT")
  console.log(`returns: ${list.length} in Linko; inserted ${stats.insert}, updated ${stats.update}, unchanged ${stats.same}; lines written ${stats.items}${extra.length ? `; local-only returns kept: ${extra.join(",")}` : ""}`)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
