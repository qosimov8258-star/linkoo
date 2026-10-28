// Removes the 'finance2' return documents and pnl_adjustments rows and restores the old finance demo returns
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query(`DELETE FROM customer_returns WHERE id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name='customer_returns' AND domain='finance2')`)
await c.query(`DELETE FROM pnl_adjustments WHERE id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name='pnl_adjustments' AND domain='finance2')`)
await c.query(`DELETE FROM demo_seed_rows WHERE table_name IN ('customer_returns','pnl_adjustments') AND domain='finance2'`)
if ((await c.query(`SELECT to_regclass('demo_seed_backup_customer_returns') t`)).rows[0].t) {
  await c.query(`INSERT INTO customer_returns SELECT * FROM demo_seed_backup_customer_returns`)
  await c.query(`INSERT INTO demo_seed_rows SELECT * FROM demo_seed_backup_customer_returns_registry`)
}
await c.query(`SELECT setval(pg_get_serial_sequence('customer_returns','id'), (SELECT COALESCE(max(id),1) FROM customer_returns))`)
await c.query('COMMIT')
console.log('restored')
await c.end()
