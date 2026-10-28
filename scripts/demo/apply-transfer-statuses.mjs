// Sets internal_transfers statuses to match the reference (user-approved 2026-10-24).
// Old values are backed up in demo_seed_updates; rollback: rollback-transfer-statuses.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
const TARGET = { approved: 'потвержден', pending: 'ожидает', given: 'в пути', accepted: 'принят' }
const ref = JSON.parse(fs.readFileSync(new URL('./data/existing-changes-reference.json', import.meta.url), 'utf8')).transferStatuses
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_updates (table_name text, row_id text, column_name text, old_value jsonb, new_value jsonb, domain text, created_at timestamptz DEFAULT now())`)
  let changed = 0
  for (const [id, refStatus] of Object.entries(ref)) {
    const want = TARGET[refStatus]
    if (!want) continue
    const cur = await c.query('SELECT status FROM internal_transfers WHERE id = $1', [Number(id)])
    if (!cur.rows.length || cur.rows[0].status === want) continue
    const done = await c.query(`SELECT 1 FROM demo_seed_updates WHERE table_name='internal_transfers' AND row_id=$1 AND column_name='status' AND domain='transfer-statuses'`, [id])
    if (!done.rows.length) {
      await c.query(`INSERT INTO demo_seed_updates (table_name,row_id,column_name,old_value,new_value,domain) VALUES ('internal_transfers',$1,'status',$2,$3,'transfer-statuses')`, [id, JSON.stringify(cur.rows[0].status), JSON.stringify(want)])
    }
    await c.query('UPDATE internal_transfers SET status = $1 WHERE id = $2', [want, Number(id)])
    changed++
  }
  await c.query('COMMIT')
  console.log('changed', changed)
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log((await c.query('SELECT status, count(*)::int n FROM internal_transfers GROUP BY 1 ORDER BY 1')).rows)
await c.end()
