// Drops the orphan tables zone_removed and order_payment_links (user-approved 2026-10-24) after backing them up.
// Backups: demo_seed_backup_zone_removed, demo_seed_backup_order_payment_links, demo_seed_backup_orphans_registry.
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_backup_orphans_registry AS SELECT * FROM demo_seed_rows WHERE table_name IN ('zone_removed','order_payment_links')`)
  for (const t of ['zone_removed', 'order_payment_links']) {
    if (!(await c.query('SELECT to_regclass($1) AS t', [t])).rows[0].t) continue
    if (!(await c.query('SELECT to_regclass($1) AS t', ['demo_seed_backup_' + t])).rows[0].t) await c.query(`CREATE TABLE demo_seed_backup_${t} AS TABLE ${t}`)
    await c.query(`DROP TABLE ${t}`)
    await c.query('DELETE FROM demo_seed_rows WHERE table_name = $1', [t])
    console.log('dropped', t)
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
