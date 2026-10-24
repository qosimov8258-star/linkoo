// "Оплаты от клиентов": soft-delete the old live sample rows of customer_payments (not the reference rows
// inserted by apply-parity-payments.mjs) so the list equals the reference. The previous values of is_deleted /
// deleted_at / deleted_by are kept in demo_seed_updates (domain 'parity-payments'). Idempotent.
// Rollback: rollback-parity-payments.mjs (restores them, and removes the inserted reference rows).
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_updates (table_name text, row_id text, column_name text, old_value jsonb, new_value jsonb, domain text, created_at timestamptz DEFAULT now())`)
  const old = (
    await c.query(
      `SELECT id, is_deleted, deleted_at, deleted_by FROM customer_payments
       WHERE is_deleted = 0 AND id::text NOT IN (SELECT row_id FROM demo_seed_rows WHERE table_name='customer_payments' AND domain='parity')`,
    )
  ).rows
  for (const r of old) {
    await c.query(
      `INSERT INTO demo_seed_updates (table_name,row_id,column_name,old_value,new_value,domain) VALUES ('customer_payments',$1,'is_deleted,deleted_at,deleted_by',$2,$3,'parity-payments')`,
      [String(r.id), JSON.stringify([r.is_deleted, r.deleted_at, r.deleted_by]), JSON.stringify([1, 'parity', 'parity'])],
    )
    await c.query(`UPDATE customer_payments SET is_deleted = 1, deleted_at = $2, deleted_by = 'parity' WHERE id = $1`, [r.id, new Date().toISOString().slice(0, 19)])
  }
  await c.query('COMMIT')
  console.log('hidden', old.length)
} catch (e) {
  await c.query('ROLLBACK')
  throw e
}
console.log((await c.query('SELECT count(*) FILTER (WHERE is_deleted=0)::int live, count(*)::int total FROM customer_payments')).rows)
await c.end()
