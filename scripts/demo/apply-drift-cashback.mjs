// Mirrors the reference's cashback request №26 (client "Оби рахмат", payme, 5 SUM, Подтверждено).
// INSERT-only; no cash entry is linked, so no ledger/cashbox effect. Registered as 'cashback_withdrawal_requests_drift' (domain 'drift')
// because the list hides rows registered under the table's own name. Rollback: rollback-drift.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())`)
  if ((await c.query('SELECT 1 FROM cashback_withdrawal_requests WHERE id = 26')).rows.length) console.log('already there')
  else {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
    await c.query(
      `INSERT INTO cashback_withdrawal_requests (id, client, amount, currency, status, created_at, updated_at, client_id, comment, source, created_by, cashbox_id)
       VALUES (26, 'Оби рахмат', 5, 'SUM', 'confirmed', $1, $1, 2911, '', 'telegram', '', 7)`, [now])
    await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('cashback_withdrawal_requests_drift', '26', 'drift')`)
    console.log('inserted 26')
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
