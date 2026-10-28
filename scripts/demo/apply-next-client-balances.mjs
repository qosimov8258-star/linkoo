// Client balances parity (user-approved 2026-10-24): clients.balance already holds the reference's final balance as the opening
// balance, so the imported reference payments (domain 'parity') counted twice for 178 clients. This INSERT-only script adds
// manual client corrections ("Произвольный") equal to reference_end_balance - local_end_balance per client and currency
// (data/next-client-balance-corrections.json, computed from stats/client_balances_expanded vs /api/balances/client).
// Rollback: rollback-next-client-balances.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(fs.readFileSync(new URL('./data/next-client-balance-corrections.json', import.meta.url), 'utf8'))
const DOMAIN = 'nextdata-clientbal'
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  const done = (await c.query(`SELECT 1 FROM demo_seed_rows WHERE table_name='client_balance_corrections' AND domain=$1 LIMIT 1`, [DOMAIN])).rows.length
  if (done) { console.log('already applied'); await c.query('ROLLBACK'); await c.end(); process.exit(0) }
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  let n = 0
  for (const [clientId, currency, amount] of rows) {
    const ok = (await c.query('SELECT 1 FROM clients WHERE id=$1', [clientId])).rows.length
    if (!ok) continue
    const res = await c.query(
      `INSERT INTO client_balance_corrections (client_id, amount, currency, payment_type, organization, correction_date, comment, delivery_man, source, created_by, created_at, is_deleted)
       VALUES ($1,$2,$3,'','','2020-01-01','Корректировка к данным референса','', 'manual','Admin Ritm',$4,0) RETURNING id`,
      [clientId, amount, currency, now],
    )
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('client_balance_corrections',$1,$2)`, [String(res.rows[0].id), DOMAIN])
    n++
  }
  await c.query('COMMIT')
  console.log('inserted', n)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
