// Removes the rows added by the final-ui seeds (registered in demo_seed_rows, domain 'final-ui').
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
const listed = (await c.query(`SELECT table_name, row_id FROM demo_seed_rows WHERE domain = 'final-ui'`)).rows
for (const { table_name: table, row_id: id } of listed) {
  if (table !== 'transfer_reference_items') continue
  await c.query('DELETE FROM transfer_reference_items WHERE id = $1', [Number(id)])
}
await c.query(`DELETE FROM demo_seed_rows WHERE domain = 'final-ui'`)
await c.query('COMMIT')
console.log('removed', listed.length)
await c.end()
