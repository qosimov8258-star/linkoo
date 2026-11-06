// Продажи → Заказы: brings the orders of the Linko account in line with it — status, the warehouse the goods leave
// (orders.warehouse, read by the stock ledger: "Есть на складе" / "Не подтвержден" reserve, "В пути" / "Доставлено"
// ship), the ship moment (shipped_at, from Linko's order history), the client (the shop: Linko's market), whether Linko
// debited the client (orders.no_debt), the product lines (order_items: price before the line discount + the discount)
// and the history (order_logs).
// Orders themselves (928, same ids) were imported earlier; the fields above are what the stock and the history need.
//
//   node scripts/linko-sync/import-orders.mjs   (raw: orders, orders_detail, order_products, order_logs)
import { connect, currencyCode, ensureRegistry, fullName, raw, register, runId, upsertById, utcIso } from "./lib.mjs"

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
const stats = { orders: { insert: 0, update: 0, same: 0 }, missingOrders: [], lineFixes: 0, linesInserted: 0, logs: 0 }
try {
  await client.query("BEGIN")
  // The first time Linko's history shows the order handed over / delivered = the moment the goods left the warehouse.
  const shippedAt = new Map()
  for (const log of [...logs].sort((a, b) => a.id - b.id)) {
    const id = typeof log.order === "object" ? log.order?.id : log.order
    if (SHIPPED.has(String(log.status)) && !shippedAt.has(id)) shippedAt.set(id, log.created_date)
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
    const shipped = SHIPPED.has(String(row.status)) ? utcIso(shippedAt.get(row.id) ?? doc.accepted_time ?? row.accepted_time ?? row.created_date) : null
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
  const haveLogs = new Set((await client.query("SELECT ref_id FROM order_logs WHERE ref_id IS NOT NULL")).rows.map((r) => r.ref_id))
  for (const log of logs) {
    if (haveLogs.has(log.id)) continue
    const orderId = typeof log.order === "object" ? log.order?.id : log.order
    if (!known.has(orderId)) continue
    const inserted = await client.query(
      `INSERT INTO order_logs (ref_id, order_id, action, status, comment, total_price, currency, pay_type_name, created_by, created_at, market_name, snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '', '[]') RETURNING id`,
      [log.id, orderId, log.action ?? "", String(log.status ?? ""), log.comment ?? "", Number(log.total_price) || 0, currencyCode(log.currency), log.custom_payment_type?.name ?? "", fullName(log.created_by), String(log.created_date ?? "").slice(0, 19)],
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
