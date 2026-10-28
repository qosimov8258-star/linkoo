// Removes the rows added by the left3 seeds (repricing_reference_lines) and drops the table when it is empty.
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
const exists = (await c.query(`SELECT to_regclass('repricing_reference_lines') AS t`)).rows[0].t
if (exists) {
  const listed = (await c.query(`SELECT row_id FROM demo_seed_rows WHERE table_name='repricing_reference_lines' AND domain='left3'`)).rows
  for (const r of listed) {
    const [id, pos] = r.row_id.split(':').map(Number)
    await c.query('DELETE FROM repricing_reference_lines WHERE repricing_id=$1 AND position=$2', [id, pos])
  }
  await c.query(`DELETE FROM demo_seed_rows WHERE table_name='repricing_reference_lines' AND domain='left3'`)
  if (!(await c.query('SELECT 1 FROM repricing_reference_lines LIMIT 1')).rows.length) await c.query('DROP TABLE repricing_reference_lines')
}
await c.query('COMMIT')
console.log('rolled back')
await c.end()
