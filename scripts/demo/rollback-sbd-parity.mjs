// Removes the mirrored stock-report history (tables created by apply-sbd-parity.mjs); the report falls back to our own ledger.
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
for (const t of ['stock_report_ref_moves', 'stock_report_ref_marks', 'stock_report_ref_meta']) await c.query(`DROP TABLE IF EXISTS ${t}`)
await c.query(`DELETE FROM demo_seed_rows WHERE domain = 'sbd-parity'`)
await c.query('COMMIT')
console.log('rolled back')
await c.end()
