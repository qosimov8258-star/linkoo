// Removes the rows made by apply-staff-balances.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
let removed = 0
for (const table of ['vansell_transactions', 'employee_balance_transactions']) {
  const ids = (await c.query(`SELECT row_id FROM demo_seed_rows WHERE table_name=$1 AND domain='staff-balances'`, [table])).rows.map((r) => Number(r.row_id))
  if (ids.length) await c.query(`DELETE FROM ${table} WHERE id = ANY($1)`, [ids])
  removed += ids.length
}
await c.query(`DELETE FROM demo_seed_rows WHERE domain='staff-balances'`)
await c.query('COMMIT')
console.log('removed', removed)
await c.end()
