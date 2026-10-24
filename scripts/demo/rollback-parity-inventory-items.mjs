// Restores the `approved` flags changed by apply-parity-inventory-items.mjs
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
const rows = (await c.query(`SELECT row_id, old_value FROM demo_seed_updates WHERE table_name='inventory_items' AND domain='parity-inventory'`)).rows
for (const r of rows) await c.query('UPDATE inventory_items SET approved = $1 WHERE id = $2', [r.old_value, Number(r.row_id)])
await c.query(`DELETE FROM demo_seed_updates WHERE table_name='inventory_items' AND domain='parity-inventory'`)
await c.query('COMMIT')
console.log('restored', rows.length)
await c.end()
