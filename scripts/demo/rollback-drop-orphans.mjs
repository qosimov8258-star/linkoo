// Recreates the dropped orphan tables from their backups
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
for (const t of ['zone_removed', 'order_payment_links']) {
  if (!(await c.query('SELECT to_regclass($1) AS t', ['demo_seed_backup_' + t])).rows[0].t) continue
  if (!(await c.query('SELECT to_regclass($1) AS t', [t])).rows[0].t) await c.query(`CREATE TABLE ${t} AS TABLE demo_seed_backup_${t}`)
}
await c.query(`INSERT INTO demo_seed_rows SELECT * FROM demo_seed_backup_orphans_registry`)
await c.query('COMMIT')
console.log('restored')
await c.end()
