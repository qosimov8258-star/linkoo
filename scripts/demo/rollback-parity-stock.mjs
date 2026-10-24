// Removes the starting quantities made by apply-parity-stock.mjs
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query(`DELETE FROM stock_opening_balances WHERE id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name='stock_opening_balances' AND domain='parity')`)
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='stock_opening_balances' AND domain='parity'`)
await c.query('COMMIT')
console.log('removed')
await c.end()
