// Removes the reference movement lines (the tab falls back to the stock ledger).
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='stock_movement_reference_rows'`)
await c.query('DROP TABLE IF EXISTS stock_movement_reference_rows')
await c.query('COMMIT')
console.log('removed')
await c.end()
