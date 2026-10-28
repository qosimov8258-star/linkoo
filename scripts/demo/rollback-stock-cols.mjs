// Removes the stock_reserved_adjustments rows made by apply-stock-cols.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
const ids = (await c.query(`SELECT row_id FROM demo_seed_rows WHERE table_name='stock_reserved_adjustments' AND domain='stock-cols'`)).rows.map((r) => Number(r.row_id))
if (ids.length) await c.query('DELETE FROM stock_reserved_adjustments WHERE id = ANY($1)', [ids])
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='stock_reserved_adjustments' AND domain='stock-cols'`)
await c.query('COMMIT')
console.log('removed', ids.length)
await c.end()
