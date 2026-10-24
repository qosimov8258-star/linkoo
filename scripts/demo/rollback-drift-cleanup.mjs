// Restores the rows removed by apply-drift-cleanup.mjs from their backup tables.
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
for (const table of ['price_lists', 'repricings', 'income_categories']) {
  if (!(await c.query('SELECT to_regclass($1) AS t', ['demo_seed_backup_drift_' + table])).rows[0].t) continue
  await c.query(`INSERT INTO ${table} SELECT * FROM demo_seed_backup_drift_${table} b WHERE NOT EXISTS (SELECT 1 FROM ${table} x WHERE x.id = b.id)`)
}
await c.query('COMMIT')
console.log('restored')
await c.end()
