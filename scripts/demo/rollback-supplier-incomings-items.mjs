// Restores items/accepted_at/phone/email of the reference supplies from demo_seed_backup_supplier_incomings_items.
import pg from "pg"
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const r = await c.query("UPDATE supplier_incomings s SET items = b.items, accepted_at = b.accepted_at, phone = b.phone, email = b.email FROM demo_seed_backup_supplier_incomings_items b WHERE b.id = s.id")
console.log("restored", r.rowCount)
await c.end()
