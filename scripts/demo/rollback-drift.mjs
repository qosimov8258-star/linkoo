// Removes the rows added by the apply-drift-*.mjs scripts (everything registered in demo_seed_rows with domain 'drift').
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
const rows = (await c.query(`SELECT table_name, row_id FROM demo_seed_rows WHERE domain = 'drift'`)).rows
for (const r of rows) {
  const table = r.table_name.replace(/_drift$/, '')
  await c.query(`DELETE FROM ${table} WHERE id::text = $1`, [r.row_id])
}
await c.query(`DELETE FROM demo_seed_rows WHERE domain = 'drift'`)
await c.query('COMMIT')
console.log('removed', rows.length)
await c.end()
