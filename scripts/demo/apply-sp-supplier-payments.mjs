// "Оплаты поставщикам" list parity (user-approved): INSERT the reference's 20 real supplier payments into
// supplier_payment_reference_rows; lib/cash/supplier-payments.ts then lists exactly those rows (+ payments created
// locally) and hides the 24 seeded demo payments from the list. Ledger / cashbox math is untouched.
// Rollback: scripts/demo/rollback-sp-supplier-payments.mjs. Data: scripts/demo/data/supplier-payments-reference.json
import pg from 'pg'
import fs from 'fs'
const DOMAIN = 'supplier-parity'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(fs.readFileSync(new URL('./data/supplier-payments-reference.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())`)
  await c.query(`CREATE TABLE IF NOT EXISTS supplier_payment_reference_rows (
    id integer PRIMARY KEY, doc_no bigint, ts timestamp, cby text NOT NULL DEFAULT '', supplier_id integer, supplier_name text NOT NULL DEFAULT '',
    organization text NOT NULL DEFAULT '', amount double precision NOT NULL, cur text NOT NULL, cashbox_id integer, cashbox_name text NOT NULL DEFAULT '',
    pt text NOT NULL DEFAULT 'cash', comment text NOT NULL DEFAULT '')`)
  let n = 0
  for (const r of rows) {
    const done = await c.query('SELECT 1 FROM supplier_payment_reference_rows WHERE id=$1', [r.id])
    if (done.rows.length) continue
    await c.query(
      `INSERT INTO supplier_payment_reference_rows (id, doc_no, ts, cby, supplier_id, supplier_name, organization, amount, cur, cashbox_id, cashbox_name, pt, comment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [r.id, r.transaction_id ?? null, r.created_date, `${r.user?.first_name ?? ''} ${r.user?.second_name ?? ''}`.trim(), r.provider.id, r.provider.name, r.division?.name ?? '',
        Number(r.amount), r.currency.name, r.cashbox?.id ?? null, r.cashbox?.name ?? '', r.payment_type === 'bank' ? 'bank' : 'cash', r.comment ?? ''],
    )
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('supplier_payment_reference_rows',$1,$2)`, [String(r.id), DOMAIN])
    n++
  }
  await c.query('COMMIT')
  console.log('inserted', n)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
