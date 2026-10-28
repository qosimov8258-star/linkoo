// Removes the reference payments inserted by apply-parity-payments.mjs and restores the old sample rows hidden by
// apply-parity-payments-hide-old.mjs
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query(`DELETE FROM customer_payments WHERE id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name='customer_payments' AND domain='parity')`)
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='customer_payments' AND domain='parity'`)
const old = (await c.query(`SELECT row_id, old_value FROM demo_seed_updates WHERE table_name='customer_payments' AND domain='parity-payments'`)).rows
for (const r of old) {
  await c.query(`UPDATE customer_payments SET is_deleted=$1, deleted_at=$2, deleted_by=$3 WHERE id=$4`, [...r.old_value, Number(r.row_id)])
}
await c.query(`DELETE FROM demo_seed_updates WHERE table_name='customer_payments' AND domain='parity-payments'`)
await c.query('COMMIT')
console.log('restored', old.length)
await c.end()
