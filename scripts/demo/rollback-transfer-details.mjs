// Restores price_list/currency/accepted_*/given_at of internal_transfers from demo_seed_backup_transfer_details.
import pg from "pg"
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const r = await c.query("UPDATE internal_transfers t SET price_list = b.price_list, currency = b.currency, accepted_at = b.accepted_at, accepted_by = b.accepted_by, given_at = b.given_at FROM demo_seed_backup_transfer_details b WHERE b.id = t.id")
console.log("restored", r.rowCount)
await c.end()
