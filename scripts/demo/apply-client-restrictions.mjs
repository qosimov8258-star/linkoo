// Makes client_restrictions equal to the reference list (user-approved 2026-10-24):
// removes the 4 old sample rows (ids 8-11) and renumbers demo rows 18/19/20 -> 8/9/10.
// Full backup: demo_seed_backup_client_restrictions. Rollback: rollback-client-restrictions.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  const exists = (await c.query(`SELECT to_regclass('demo_seed_backup_client_restrictions') AS t`)).rows[0].t
  if (!exists) {
    await c.query(`CREATE TABLE demo_seed_backup_client_restrictions AS TABLE client_restrictions`)
    await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_backup_client_restrictions_registry AS SELECT * FROM demo_seed_rows WHERE table_name='client_restrictions'`)
  }
  const samples = (await c.query(`SELECT id FROM client_restrictions WHERE id IN (8,9,10,11) AND config = '{}'`)).rows.map((r) => r.id)
  if (samples.length) await c.query(`DELETE FROM client_restrictions WHERE id = ANY($1) AND config = '{}'`, [samples])
  const moves = [[18, 8], [19, 9], [20, 10]]
  for (const [from, to] of moves) {
    const has = (await c.query('SELECT 1 FROM client_restrictions WHERE id=$1', [from])).rows.length
    const free = !(await c.query('SELECT 1 FROM client_restrictions WHERE id=$1', [to])).rows.length
    if (has && free) {
      await c.query('UPDATE client_restrictions SET id=$1 WHERE id=$2', [to, from])
      await c.query(`UPDATE demo_seed_rows SET row_id=$1 WHERE table_name='client_restrictions' AND row_id=$2`, [String(to), String(from)])
    }
  }
  const seq = (await c.query(`SELECT pg_get_serial_sequence('client_restrictions','id') AS s`)).rows[0].s
  if (seq) await c.query(`SELECT setval($1, (SELECT COALESCE(MAX(id),1) FROM client_restrictions))`, [seq])
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log((await c.query('SELECT id,name FROM client_restrictions ORDER BY id')).rows.map((r) => r.id + ':' + r.name).join(' | '))
await c.end()
