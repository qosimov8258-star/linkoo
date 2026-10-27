// Undoes seed-tracking-way-order.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query(`DELETE FROM tracking_way_order WHERE id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name='tracking_way_order' AND domain='tracking-way-order')`)
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='tracking_way_order' AND domain='tracking-way-order'`)
await c.query('COMMIT')
console.log('restored')
await c.end()
