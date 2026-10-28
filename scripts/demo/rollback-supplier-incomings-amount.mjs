// Restores supplier_incomings.amount/paid from demo_seed_backup_supplier_incomings_amount (column types stay double precision).
import pg from "pg"
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const r = await c.query("UPDATE supplier_incomings s SET amount = b.amount, paid = b.paid FROM demo_seed_backup_supplier_incomings_amount b WHERE b.id = s.id")
console.log("restored", r.rowCount)
await c.end()
