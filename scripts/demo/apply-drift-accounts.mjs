// "Долги по счетам" / "Сверка счетов": the reference lists 4306 accounts, the local ledger 4269. Adds account_reference_rows:
// 44 accounts the reference lists that have no local client (name + balance as in the reference) and 7 local accounts it does
// not list (hidden = 1). The balance list (lib/finance/ledger.ts, kind account) merges them; no client / ledger row is touched.
// Registered as 'account_reference_rows_drift' (domain 'drift'); rollback-drift.mjs deletes the rows.
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const data = JSON.parse(fs.readFileSync(new URL('./data/account-reference-rows.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())`)
  await c.query(`CREATE TABLE IF NOT EXISTS account_reference_rows (id serial PRIMARY KEY, acc_key text NOT NULL UNIQUE, name text NOT NULL DEFAULT '', balances jsonb NOT NULL DEFAULT '{}', hidden integer NOT NULL DEFAULT 0)`)
  let n = 0
  for (const r of [...data.add.map((x) => ({ ...x, hidden: 0 })), ...data.hide.map((x) => ({ ...x, balances: {}, hidden: 1 }))]) {
    const res = await c.query(`INSERT INTO account_reference_rows (acc_key, name, balances, hidden) VALUES ($1,$2,$3,$4) ON CONFLICT (acc_key) DO NOTHING RETURNING id`, [r.acc_key, r.name, JSON.stringify(r.balances), r.hidden])
    if (res.rowCount) {
      await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('account_reference_rows_drift', $1, 'drift')`, [String(res.rows[0].id)])
      n++
    }
  }
  console.log('inserted', n)
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
