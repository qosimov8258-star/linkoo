// Restores currency/contract_number from demo_seed_backup_supplier_incomings_cur.
import pg from "pg"
const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const r = await c.query("UPDATE supplier_incomings s SET currency = b.currency, contract_number = b.contract_number FROM demo_seed_backup_supplier_incomings_cur b WHERE b.id = s.id")
console.log("restored", r.rowCount)
await c.end()
