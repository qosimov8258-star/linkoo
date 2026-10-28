// Removes the rows registered under domain 'set-left' (test rows of the attendance recalculation API etc.)
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
const KEYS = { attendance_recalc_days: 'day' }
const rows = (await c.query(`SELECT table_name,row_id FROM demo_seed_rows WHERE domain='set-left'`)).rows
for (const r of rows) {
  const key = KEYS[r.table_name]
  if (key) await c.query(`DELETE FROM ${r.table_name} WHERE ${key}::text = $1`, [r.row_id])
}
await c.query(`DELETE FROM demo_seed_rows WHERE domain='set-left'`)
await c.query('COMMIT')
console.log('removed', rows.length)
await c.end()
