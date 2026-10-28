// "Сверка счетов" parity (user-approved): the reference lists 4306 shops (sales/client_balances) with their cash/bank
// balances per currency. INSERT them into store_reconciliation_reference_rows; lib/finance-store-reconciliation.ts
// (variant "account") then shows exactly those rows (+ clients created after them). Ledger / "Баланс клиентов" untouched.
// Rollback: scripts/demo/rollback-sp-store-reconciliation.mjs. Data: scripts/demo/data/store-reconciliation-reference.json
import pg from 'pg'
import fs from 'fs'
const DOMAIN = 'supplier-parity'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(fs.readFileSync(new URL('./data/store-reconciliation-reference.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())`)
  await c.query(`CREATE TABLE IF NOT EXISTS store_reconciliation_reference_rows (
    id integer PRIMARY KEY, name text NOT NULL DEFAULT '', created_date text NOT NULL DEFAULT '', orders integer NOT NULL DEFAULT 0, money jsonb NOT NULL DEFAULT '{}'::jsonb)`)
  const have = (await c.query('SELECT count(*)::int n FROM store_reconciliation_reference_rows')).rows[0].n
  if (have >= rows.length) { console.log('already applied', have); await c.query('ROLLBACK'); process.exit(0) }
  const chunk = 500
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk)
    await c.query(
      `INSERT INTO store_reconciliation_reference_rows (id, name, created_date, orders, money)
       SELECT (r->>'id')::int, r->>'name', COALESCE(r->>'created',''), COALESCE((r->>'orders')::int,0), COALESCE(r->'money','{}'::jsonb)
       FROM jsonb_array_elements($1::jsonb) r ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify(part)],
    )
  }
  await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('store_reconciliation_reference_rows','*',$1)`, [DOMAIN])
  await c.query('COMMIT')
  console.log('inserted', rows.length)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
