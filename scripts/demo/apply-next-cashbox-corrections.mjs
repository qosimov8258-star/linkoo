// Cashbox parity, additive variant (user-approved 2026-10-24): the reference cashbox balance equals the sum of its 548
// transactions, while ours also contains demo/legacy cash rows. Removing those was refused by the permission system, so this
// INSERT-only script adds ONE correction entry per differing cashbox (reference_balance - local_balance, in the cashbox currency,
// dated 2020-01-01, category 'Корректировка') computed in data/next-cashbox-corrections.json. Rollback: rollback-next-cashbox-corrections.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(fs.readFileSync(new URL('./data/next-cashbox-corrections.json', import.meta.url), 'utf8'))
const DOMAIN = 'nextdata-cashbox-corr'
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  if ((await c.query(`SELECT 1 FROM demo_seed_rows WHERE table_name='cash_management_entries' AND domain=$1 LIMIT 1`, [DOMAIN])).rows.length) { console.log('already applied'); await c.query('ROLLBACK'); await c.end(); process.exit(0) }
  const rate = Object.fromEntries((await c.query(`SELECT UPPER(code) AS k, MAX(rate)::float AS r FROM currencies GROUP BY 1`)).rows.map((r) => [r.k, r.r]))
  let doc = Number((await c.query(`SELECT COALESCE(MAX(doc_no),0)::bigint AS m FROM cash_management_entries`)).rows[0].m)
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
  let n = 0
  for (const [cashboxId, currency, amount, name] of rows) {
    const cb = (await c.query('SELECT branch, payment_type FROM cashboxes WHERE id=$1', [cashboxId])).rows[0]
    if (!cb) continue
    const internal = amount * (rate[String(currency).toUpperCase()] ?? 1)
    const res = await c.query(
      `INSERT INTO cash_management_entries
        (cashbox_id, description, category, client_name, branch, organization, comment, entry_date, amount, created_at, updated_at, created_by, doc_no,
         currency, payment_type, internal_amount, custom_rate, rate_type, is_verified, verified_at, verified_by, is_deleted, deleted_at, deleted_by)
       VALUES ($1,'Корректировка остатка кассы','Корректировка','',$2,'Linko Distribution','Корректировка к данным референса','2020-01-01',$3,$4,$4,'Admin Ritm',$5,$6,$7,$8,$9,'current',1,$4,'Admin Ritm',0,'','') RETURNING id`,
      [cashboxId, cb.branch ?? '', amount, now, ++doc, currency, cb.payment_type ?? '', internal, rate[String(currency).toUpperCase()] ?? 1],
    )
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('cash_management_entries',$1,$2)`, [String(res.rows[0].id), DOMAIN])
    n++
  }
  await c.query('COMMIT')
  console.log('inserted', n)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
