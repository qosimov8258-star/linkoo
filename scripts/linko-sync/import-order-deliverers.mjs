// Долги доставщиков: Linko books an order's debit to the delivery man the order had when it was booked, and keeps it
// there when the order's delivery man is changed later. For the orders where the two differ, orders.debt_delivery_man_id
// keeps the one Linko booked (0 = nobody); NULL = the order's own delivery man (every order the app writes).
// Every change is registered in linko_sync_rows (previous value), like the other importers.
//
//   node scripts/linko-sync/import-order-deliverers.mjs   (raw: orders, client_transactions)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const orders = new Map(raw("orders").map((row) => [row.id, row]))
// Linko's client ledger: the debit of each order (client transaction of type 4) with its own delivery man.
const booked = new Map()
for (const t of raw("client_transactions")) {
  if (t.type === 4 && t.order) booked.set(t.order, t.delivery_man?.id ?? 0)
}
const run = runId("order-deliverers")

const client = await connect()
await ensureRegistry(client)
const stats = { set: 0, cleared: 0, same: 0, missing: 0 }
try {
  await client.query("BEGIN")
  await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS debt_delivery_man_id INTEGER")
  const known = new Map((await client.query("SELECT id, debt_delivery_man_id FROM orders")).rows.map((row) => [row.id, row.debt_delivery_man_id]))
  for (const [orderId, deliverer] of booked) {
    if (!known.has(orderId)) {
      stats.missing++
      continue
    }
    const own = orders.get(orderId)?.delivery_man?.id ?? 0
    const want = deliverer === own ? null : deliverer
    const have = known.get(orderId)
    if (have === want || (have == null && want == null)) {
      stats.same++
      continue
    }
    await client.query("UPDATE orders SET debt_delivery_man_id = $2 WHERE id = $1", [orderId, want])
    await register(client, run, "orders", orderId, "update", { debt_delivery_man_id: have ?? null })
    stats[want == null ? "cleared" : "set"]++
  }
  await client.query("COMMIT")
  console.log(JSON.stringify(stats))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
