// "Баланс вансел" / "Баланс сотрудников" parity (user-approved reference alignment, 2026-10-26): per person/currency
// correction rows so the opening balance (before 2026-10-01) and the month's end balance equal the reference. Insert-only:
// vansell_transactions / employee_balance_transactions rows registered in demo_seed_rows (domain 'staff-balances');
// rollback-staff-balances.mjs removes exactly them. Deltas come from data/staff-balance-deltas.json
// ([kind, employee id, currency, date, signed amount]).
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const deltas = JSON.parse(fs.readFileSync(new URL('./data/staff-balance-deltas.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query("CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())")
  const done = (await c.query(`SELECT 1 FROM demo_seed_rows WHERE domain='staff-balances' LIMIT 1`)).rows.length
  if (done) throw new Error('already applied')
  let added = 0
  for (const [kind, empId, cur, date, amount] of deltas) {
    const currency = cur.toLowerCase()
    let table, id
    if (kind === 'vansell') {
      table = 'vansell_transactions'
      id = (await c.query(
        `INSERT INTO vansell_transactions (employee_id, currency, amount, type, comment, created_date, created_by, updated_at) VALUES ($1,$2,$3,'none_type','Reference balance alignment',$4,'admin',$5) RETURNING id`,
        [empId, currency, amount, date + 'T00:00', date + ' 00:00:00'],
      )).rows[0].id
    } else {
      table = 'employee_balance_transactions'
      id = (await c.query(
        `INSERT INTO employee_balance_transactions (employee_id, kind, currency, amount, date, comment, type, created_by) VALUES ($1,$2,$3,$4,$5,'Reference balance alignment','none_type','admin') RETURNING id`,
        [empId, amount < 0 ? 'expense' : 'add', currency, Math.abs(amount), date],
      )).rows[0].id
    }
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ($1,$2,'staff-balances')`, [table, String(id)])
    added++
  }
  await c.query('COMMIT')
  console.log('added', added)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
