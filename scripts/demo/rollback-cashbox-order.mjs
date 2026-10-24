// Removes the rows seed-cashbox-order.mjs inserted (cashboxes fall back to position / newest-first order).
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query(`DELETE FROM cashbox_reference_order WHERE cashbox_id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name = 'cashbox_reference_order' AND domain = 'qa5')`)
await c.query(`DELETE FROM demo_seed_rows WHERE table_name = 'cashbox_reference_order' AND domain = 'qa5'`)
await c.query('COMMIT')
await c.end()
console.log('rolled back')
