// Step 1 of the P&L returns alignment (user-approved 2026-10-24): backs up and removes the finance demo customer_returns rows.
// Backup: demo_seed_backup_customer_returns(+_registry). Rollback: rollback-pnl-returns.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  if ((await c.query(`SELECT to_regclass('demo_seed_backup_customer_returns') t`)).rows[0].t) { console.log('already removed'); await c.query('ROLLBACK'); await c.end(); process.exit(0) }
  await c.query(`CREATE TABLE demo_seed_backup_customer_returns AS SELECT r.* FROM customer_returns r JOIN demo_seed_rows d ON d.table_name='customer_returns' AND d.row_id=r.id::text AND d.domain='finance'`)
  await c.query(`CREATE TABLE demo_seed_backup_customer_returns_registry AS SELECT * FROM demo_seed_rows WHERE table_name='customer_returns' AND domain='finance'`)
  const del = await c.query(`DELETE FROM customer_returns WHERE id IN (SELECT id FROM demo_seed_backup_customer_returns)`)
  await c.query(`DELETE FROM demo_seed_rows WHERE table_name='customer_returns' AND domain='finance'`)
  await c.query('COMMIT')
  console.log('removed', del.rowCount)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
