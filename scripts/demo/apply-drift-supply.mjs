// Mirrors the reference's newest supply №353 (inventory surplus accepted 2026-10-24 10:01, robot moshina x1 at "05,08,2025(1)").
// INSERT-only. The row is NOT registered under table_name 'supplier_incomings' (the list hides those) but as
// 'supplier_incomings_drift' so rollback-drift.mjs can find it. Stock is unaffected (items = [] like every reference row).
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())`)
  const has = (await c.query('SELECT 1 FROM supplier_incomings WHERE id = 353')).rows.length
  if (!has) {
    await c.query(
      `INSERT INTO supplier_incomings (id, supplier, warehouse, date, payment_type, contract_number, amount, status, invoice_number, organization, branch, phone, email, initiator, paid, time, comment, items, created_at, updated_at, currency, invoice_date, accepted_at, accepted_by, invoice_id)
       VALUES (353, 'Инвенторизация', '05,08,2025(1)', '24 окт. 2026', 'Наличный', '', 80140.37, 'принят', '', '05,08,2025', 'Buxoro', 'Не указан', 'Не указан', 'Admin Ritm', 80140.372958, '', '', '[]', '2026-10-24', $1, 'SUM', '', '', '', NULL)`,
      [new Date().toISOString().replace('T', ' ').slice(0, 19)],
    )
    await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('supplier_incomings_drift', '353', 'drift')`)
    console.log('inserted 353')
  } else console.log('already there')
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
