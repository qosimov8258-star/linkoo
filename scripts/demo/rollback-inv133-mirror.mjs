// Restores our QA test inventory #133 (and its item) from demo_seed_updates (domain 'inv133-mirror')
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
const rows = (await c.query(`SELECT table_name,row_id,column_name,old_value FROM demo_seed_updates WHERE domain='inv133-mirror'`)).rows
for (const r of rows) await c.query(`UPDATE ${r.table_name} SET ${r.column_name} = $1 WHERE id = $2`, [r.old_value, Number(r.row_id)])
await c.query(`DELETE FROM demo_seed_updates WHERE domain='inv133-mirror'`)
await c.query('COMMIT')
console.log('restored', rows.length)
await c.end()
