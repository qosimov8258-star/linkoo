// Removes the corrections added by apply-next-client-balances.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query(`DELETE FROM client_balance_corrections WHERE id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name='client_balance_corrections' AND domain='nextdata-clientbal')`)
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='client_balance_corrections' AND domain='nextdata-clientbal'`)
await c.query('COMMIT')
console.log('removed')
await c.end()
