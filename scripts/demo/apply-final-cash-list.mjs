// Makes the "Управления кассой" LIST equal to the reference: imports the reference's 548 verified + 2 unverified
// transactions (read-only copy of finance/transaction/ and unverified_transactions/) into cash_reference_rows and
// records the highest ids of the real tables in cash_list_cutoff, so the list shows the reference rows plus operations
// created afterwards. Balances/ledger/P&L never read these tables (cashbox balances keep using the real tables).
// Idempotent. Rollback: rollback-final-cash-list.mjs
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(fs.readFileSync(new URL('./data/cash-reference-rows.json', import.meta.url), 'utf8'))
const DOMAIN = 'finalcash'

const DDL = `
CREATE TABLE IF NOT EXISTS cash_reference_rows (
  id INTEGER PRIMARY KEY, op INTEGER NOT NULL, ts TIMESTAMP, cts TIMESTAMP, cby TEXT NOT NULL DEFAULT '',
  cashbox_id INTEGER NOT NULL, pt TEXT NOT NULL DEFAULT 'cash', amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  base_amount DOUBLE PRECISION, rate DOUBLE PRECISION, client_id INTEGER, client_name TEXT NOT NULL DEFAULT '',
  supplier_id INTEGER, supplier_name TEXT NOT NULL DEFAULT '', category_id INTEGER, category_kind TEXT NOT NULL DEFAULT '',
  category_name TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', organization TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '', employee_id INTEGER, employee_name TEXT NOT NULL DEFAULT '', order_id INTEGER,
  supply_id INTEGER, supply_expense_id INTEGER, money_request_id INTEGER, contract TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 1, extra TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS cash_list_cutoff (src TEXT PRIMARY KEY, max_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now());`

const person = (p) => (p ? [p.first_name, p.second_name].filter(Boolean).join(' ').trim() : '')
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(DDL)
  // contract id -> printed number ("Контракт: 3")
  const contractNo = new Map()
  const hasContracts = (await c.query(`SELECT to_regclass('contract_reference_rows') AS t`)).rows[0].t
  if (hasContracts) for (const r of (await c.query('SELECT id, full_number FROM contract_reference_rows')).rows) contractNo.set(Number(r.id), String(r.full_number))

  let inserted = 0
  for (const r of rows) {
    const cat = r.income_category ?? r.expense_category
    const kind = r.income_category ? 'income' : r.expense_category ? 'expense' : ''
    const options = (cat?.options ?? []).map((o) => o.key_name)
    const t = r.transfer
    const extra = {
      options,
      children: (r.transaction_child ?? []).map((ch) => ({ name: ch.name, amount: Number(ch.amount) })),
      internal: Boolean(r.internal_transfer),
      transferId: t?.id ?? null,
      other: r.type === 2 ? t?.from_cashbox?.name ?? '' : '',
      accFrom: t?.accumulated_money_begin_date ?? '',
      accTo: t?.accumulated_money_end_date ?? '',
    }
    // The reference prints a person only for "Принято денег с …" (type 8); `who_took` is empty everywhere.
    const employee = r.type === 8 ? r.user : null
    const res = await c.query(
      `INSERT INTO cash_reference_rows (id, op, ts, cts, cby, cashbox_id, pt, amount, base_amount, rate, client_id, client_name,
         supplier_id, supplier_name, category_id, category_kind, category_name, branch, organization, comment, employee_id,
         employee_name, order_id, supply_id, supply_expense_id, money_request_id, contract, verified, extra)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
       ON CONFLICT (id) DO UPDATE SET op = EXCLUDED.op, ts = EXCLUDED.ts, cts = EXCLUDED.cts, cby = EXCLUDED.cby, cashbox_id = EXCLUDED.cashbox_id,
         pt = EXCLUDED.pt, amount = EXCLUDED.amount, base_amount = EXCLUDED.base_amount, rate = EXCLUDED.rate, client_id = EXCLUDED.client_id,
         client_name = EXCLUDED.client_name, supplier_id = EXCLUDED.supplier_id, supplier_name = EXCLUDED.supplier_name,
         category_id = EXCLUDED.category_id, category_kind = EXCLUDED.category_kind, category_name = EXCLUDED.category_name,
         branch = EXCLUDED.branch, organization = EXCLUDED.organization, comment = EXCLUDED.comment, employee_id = EXCLUDED.employee_id,
         employee_name = EXCLUDED.employee_name, order_id = EXCLUDED.order_id, supply_id = EXCLUDED.supply_id,
         supply_expense_id = EXCLUDED.supply_expense_id, money_request_id = EXCLUDED.money_request_id, contract = EXCLUDED.contract,
         verified = EXCLUDED.verified, extra = EXCLUDED.extra
       RETURNING (xmax = 0) AS inserted`,
      [
        r.id, r.type, r.date, r.created_date ?? r.date, person(r.created_by), r.cashbox.id, r.cashbox.type ?? r.payment_type,
        Number(r.amount), num(r.internal_amount), num(r.custom_rate), r.client?.id ?? null, r.client?.name ?? '',
        r.provider?.id ?? null, r.provider?.name ?? '', cat?.id ?? null, kind, cat?.name ?? '', r.branch?.name ?? '',
        r.division?.name ?? '', r.comment ?? '', employee?.id ?? null, person(employee), r.order ?? null, r.supply ?? null,
        r.supply_expense ?? null, r.money_request ?? null, '', // the reference list never prints the contract (contractNo kept for reference)
        r.is_verified ? 1 : 0, JSON.stringify(extra),
      ],
    )
    if (res.rows[0]?.inserted) {
      inserted++
      await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('cash_reference_rows', $1, $2)`, [String(r.id), DOMAIN])
    }
  }
  // Highest ids of the real tables: everything above is a NEW operation and stays in the list.
  const sources = { cash: 'cash_management_entries', customer: 'customer_payments', supplier: 'supplier_payments', acceptance: 'cash_acceptances' }
  for (const [src, table] of Object.entries(sources)) {
    const max = (await c.query(`SELECT COALESCE(MAX(id), 0)::int AS m FROM ${table}`)).rows[0].m
    const done = await c.query('INSERT INTO cash_list_cutoff (src, max_id) VALUES ($1, $2) ON CONFLICT (src) DO NOTHING', [src, max])
    if (done.rowCount) await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('cash_list_cutoff', $1, $2)`, [src, DOMAIN])
  }
  await c.query('COMMIT')
  console.log('inserted', inserted, 'of', rows.length)
} catch (e) {
  await c.query('ROLLBACK')
  throw e
}
console.log((await c.query('SELECT src, max_id FROM cash_list_cutoff ORDER BY src')).rows)
await c.end()
