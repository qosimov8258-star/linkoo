// "Баланс поставщиков" parity (user-approved): adds one clearly labelled correction row per supplier/currency so the
// ledger's final balances equal the reference's. INSERT-only; rows are registered in demo_seed_rows (domain 'supplier-parity').
// Rollback: scripts/demo/rollback-sp-supplier-balance.mjs. Data: scripts/demo/data/supplier-balance-corrections.json
import pg from 'pg'
import fs from 'fs'
const DOMAIN = 'supplier-parity'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(fs.readFileSync(new URL('./data/supplier-balance-corrections.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())`)
  const done = (await c.query(`SELECT count(*)::int n FROM demo_seed_rows WHERE table_name='supplier_balance_transactions' AND domain=$1`, [DOMAIN])).rows[0].n
  if (done > 0) { console.log('already applied', done); await c.query('ROLLBACK'); process.exit(0) }
  let n = 0
  for (const r of rows) {
    if (!Number.isFinite(r.delta) || Math.abs(r.delta) < 0.0005) continue
    const exists = (await c.query('SELECT 1 FROM suppliers WHERE id=$1', [r.supplierId])).rows.length
    if (!exists) continue
    const kind = r.delta > 0 ? 'add' : 'expense'
    const ins = await c.query(
      `INSERT INTO supplier_balance_transactions (supplier_id, kind, currency, amount, date, comment, created_at, created_by, status)
       VALUES ($1,$2,$3,$4,'2000-01-01','Корректировка остатка (parity)', to_char(now(),'YYYY-MM-DD HH24:MI:SS'), 'system', '') RETURNING id`,
      [r.supplierId, kind, r.currency, Math.abs(r.delta)],
    )
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('supplier_balance_transactions',$1,$2)`, [String(ins.rows[0].id), DOMAIN])
    n++
  }
  await c.query('COMMIT')
  console.log('inserted', n)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
