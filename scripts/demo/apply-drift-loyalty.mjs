// "Накопительная карта": the reference lists 4306 clients, the local list 4294. Adds loyalty_reference_rows (id = client id):
// 16 clients the reference lists that the local client table lacks (shown with the reference's name/balance) and 4 local rows it does not
// list (hidden = 1: QA ghost 4616 and 3 clients). The list repo reads the table; no ledger / client row is touched.
// Registered as 'loyalty_reference_rows_drift' (domain 'drift'); rollback-drift.mjs deletes the rows.
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const data = JSON.parse(fs.readFileSync(new URL('./data/loyalty-reference-rows.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())`)
  await c.query(`CREATE TABLE IF NOT EXISTS loyalty_reference_rows (id integer PRIMARY KEY, name text NOT NULL DEFAULT '', last_created text, balances jsonb NOT NULL DEFAULT '{}', hidden integer NOT NULL DEFAULT 0)`)
  let n = 0
  for (const r of [...data.add.map((x) => ({ ...x, hidden: 0 })), ...data.hide]) {
    const res = await c.query(
      `INSERT INTO loyalty_reference_rows (id, name, last_created, balances, hidden) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
      [r.client_id, r.name ?? '', r.last_created ? String(r.last_created).slice(0, 19) : null, JSON.stringify(r.balances ?? {}), r.hidden],
    )
    if (res.rowCount) {
      await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('loyalty_reference_rows_drift', $1, 'drift')`, [String(r.client_id)])
      n++
    }
  }
  console.log('inserted', n)
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
