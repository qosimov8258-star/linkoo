// Removes the correction rows inserted by apply-sp-supplier-balance.mjs (only those registered in demo_seed_rows).
import pg from 'pg'
import fs from 'fs'
const DOMAIN = 'supplier-parity'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
const ids = (await c.query(`SELECT row_id FROM demo_seed_rows WHERE table_name='supplier_balance_transactions' AND domain=$1`, [DOMAIN])).rows.map((r) => Number(r.row_id))
if (ids.length) await c.query('DELETE FROM supplier_balance_transactions WHERE id = ANY($1)', [ids])
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='supplier_balance_transactions' AND domain=$1`, [DOMAIN])
await c.query('COMMIT')
console.log('removed', ids.length)
await c.end()
