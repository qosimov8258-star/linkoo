// Продажи → Заказы → «Организация» filter: the id of the division (organization) of every order copied from Linko, into
// orders.organization_id. Linko filters orders by division id, and several of its divisions share a name, so the name in
// orders.organization alone cannot tell them apart. Only that column of rows that exist already (import-orders.mjs) is
// written, and only with an id the organizations table knows. Each change is registered in linko_sync_rows with the
// previous value.
//
//   node scripts/linko-sync/import-order-divisions.mjs     (raw file: orders; RAW=<dir> picks the folder)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const orders = raw("orders")
const run = runId("order-divisions")
const client = await connect()
await ensureRegistry(client)
const stats = { update: 0, same: 0, missingOrder: 0, unknownDivision: [] }
try {
  await client.query("BEGIN")
  // Same column as lib/orders-repo.ts adds (ORDER_COLUMNS).
  await client.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS organization_id INTEGER")
  const known = new Set((await client.query("SELECT id FROM organizations")).rows.map((row) => Number(row.id)))
  for (const order of orders) {
    const division = Number(order.division?.id)
    if (!Number.isInteger(division) || division <= 0) continue
    if (!known.has(division)) {
      stats.unknownDivision.push(order.id)
      continue
    }
    const row = (await client.query("SELECT id, organization_id FROM orders WHERE id = $1", [order.id])).rows[0]
    if (!row) {
      stats.missingOrder++
      continue
    }
    if (row.organization_id !== null && Number(row.organization_id) === division) {
      stats.same++
      continue
    }
    await client.query("UPDATE orders SET organization_id = $2 WHERE id = $1", [row.id, division])
    await register(client, run, "orders", row.id, "update", { organization_id: row.organization_id })
    stats.update++
  }
  await client.query("COMMIT")
  console.log(`order divisions: ${orders.length} in Linko →`, JSON.stringify(stats))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
