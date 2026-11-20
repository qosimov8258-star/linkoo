// Продажи → Заказы, the order card: the promotions Linko applied to each order and its bonus lines.
// - orders.promotions: Linko's order.promotions as [{id, name, type}] in Linko's order («Задействованные акции»; the app
//   reads the name and type from Маркетинговые акции while the promotion exists, lib/order-promotions-repo.ts).
// - order_items.is_bonus: 1 for a line Linko marks is_bonus (the card's green «(бонус)», 0 in «Скидка»).
// Linko's lines are matched to the copied ones the way import-orders.mjs matched them (same order, same product, same
// quantity first). Every change is registered in linko_sync_rows (previous value), like the other importers.
//
//   node scripts/linko-sync/import-order-promotions.mjs   (raw: orders_detail, order_products)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const details = raw("orders_detail")
const lines = raw("order_products")
const run = runId("order-promotions")

// Linko's bonus flag per order line id (the lines and the order details both carry it).
const bonus = new Map()
for (const doc of Object.values(details)) for (const p of doc?.products ?? []) if (p.is_bonus === true) bonus.set(p.id, true)
for (const line of lines) if (line.is_bonus === true) bonus.set(line.id, true)

const client = await connect()
await ensureRegistry(client)
const stats = { orders: { set: 0, same: 0 }, lines: { set: 0, same: 0, unmatched: 0 }, missingOrders: 0 }
try {
  await client.query("BEGIN")
  await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS promotions TEXT NOT NULL DEFAULT '[]'")
  await client.query("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS is_bonus INTEGER NOT NULL DEFAULT 0")
  const known = new Map((await client.query("SELECT id, promotions FROM orders")).rows.map((row) => [row.id, row.promotions]))

  for (const [key, doc] of Object.entries(details)) {
    const orderId = Number(key)
    if (!doc || doc.__status) continue
    if (!known.has(orderId)) {
      stats.missingOrders++
      continue
    }
    const want = JSON.stringify((doc.promotions ?? []).map((p) => ({ id: p.id, name: p.name ?? "", type: p.type ?? "" })))
    const have = known.get(orderId) ?? "[]"
    if (have === want) {
      stats.orders.same++
      continue
    }
    await client.query("UPDATE orders SET promotions = $2 WHERE id = $1", [orderId, want])
    await register(client, run, "orders", orderId, "update", { promotions: have })
    stats.orders.set++
  }

  const byOrder = new Map()
  for (const line of lines) {
    if (!byOrder.has(line.order_id)) byOrder.set(line.order_id, [])
    byOrder.get(line.order_id).push(line)
  }
  for (const [orderId, want] of byOrder) {
    if (!known.has(orderId)) continue
    const have = (await client.query("SELECT id, product_id, quantity, is_bonus FROM order_items WHERE order_id = $1 ORDER BY id", [orderId])).rows
    const used = new Set()
    for (const line of want.sort((a, b) => a.id - b.id)) {
      const qty = Number(line.amount)
      const match =
        have.find((h) => !used.has(h.id) && h.product_id === line.product_id && Math.abs(h.quantity - qty) < 1e-6) ??
        have.find((h) => !used.has(h.id) && h.product_id === line.product_id)
      if (!match) {
        stats.lines.unmatched++
        continue
      }
      used.add(match.id)
      const flag = bonus.get(line.id) ? 1 : 0
      if (Number(match.is_bonus) === flag) {
        stats.lines.same++
        continue
      }
      await client.query("UPDATE order_items SET is_bonus = $2 WHERE id = $1", [match.id, flag])
      await register(client, run, "order_items", match.id, "update", { is_bonus: Number(match.is_bonus) })
      stats.lines.set++
    }
  }
  await client.query("COMMIT")
  console.log(JSON.stringify(stats))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
