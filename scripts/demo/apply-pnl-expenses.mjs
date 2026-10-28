// P&L expense/other-income alignment with the reference (user-approved 2026-10-24).
// 1) backs up and removes the finance demo expense entries (+ "Прочие приходы" demo entries),
// 2) inserts the reference's own 90 expense transactions (domain 'finance2').
// Backups: demo_seed_backup_cash_management_entries(+_registry). Rollback: rollback-pnl-expenses.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const data = JSON.parse(fs.readFileSync(new URL('./data/pnl-reference-expenses.json', import.meta.url), 'utf8')).rows
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  const done = (await c.query(`SELECT count(*)::int n FROM demo_seed_rows WHERE table_name='cash_management_entries' AND domain='finance2'`)).rows[0].n
  if (done > 0) { console.log('already applied', done); await c.query('ROLLBACK'); await c.end(); process.exit(0) }
  const doomed = `SELECT e.id FROM cash_management_entries e
    JOIN demo_seed_rows d ON d.table_name='cash_management_entries' AND d.row_id=e.id::text AND d.domain='finance'
    WHERE (e.expense_category_id IS NOT NULL OR e.income_category_id IN (SELECT id FROM income_categories WHERE other_income=1))
      AND NOT EXISTS (SELECT 1 FROM cashback_withdrawal_requests k WHERE k.cash_entry_id = e.id)`
  await c.query(`CREATE TABLE demo_seed_backup_cash_management_entries AS SELECT * FROM cash_management_entries WHERE id IN (${doomed})`)
  await c.query(`CREATE TABLE demo_seed_backup_cash_management_entries_registry AS SELECT * FROM demo_seed_rows WHERE table_name='cash_management_entries' AND domain='finance' AND row_id IN (SELECT id::text FROM demo_seed_backup_cash_management_entries)`)
  const removed = await c.query(`DELETE FROM cash_management_entries WHERE id IN (SELECT id FROM demo_seed_backup_cash_management_entries)`)
  await c.query(`DELETE FROM demo_seed_rows WHERE table_name='cash_management_entries' AND domain='finance' AND row_id IN (SELECT id::text FROM demo_seed_backup_cash_management_entries)`)
  console.log('removed demo entries', removed.rowCount)

  const clients = new Set((await c.query('SELECT id FROM clients')).rows.map((r) => r.id))
  const cashboxes = new Set((await c.query('SELECT id FROM cashboxes')).rows.map((r) => r.id))
  let docNo = Number((await c.query('SELECT COALESCE(max(doc_no),0) m FROM cash_management_entries')).rows[0].m)
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date))
  let inserted = 0
  for (const r of sorted) {
    const amount = Number(r.amount)
    const internal = Number(r.internal_amount)
    const cashbox = cashboxes.has(r.cashbox_id) ? r.cashbox_id : 1
    const created = (r.created_date || r.date).replace('T', ' ').slice(0, 19)
    const res = await c.query(
      `INSERT INTO cash_management_entries
        (cashbox_id, description, category, client_name, branch, organization, comment, entry_date, amount, created_at, updated_at, created_by, doc_no,
         expense_category_id, client_id, currency, internal_amount, custom_rate, is_verified, is_deleted, deleted_at, deleted_by)
       VALUES ($1,$2,$3,$4,$5,'Linko Distribution',$6,$7,$8,$9,$9,'Admin Ritm',$10,$11,$12,$13,$14,$15,$16,0,'','') RETURNING id`,
      [cashbox, `Расход: ${r.category}`, r.category, r.client_name ?? '', r.branch ?? 'Toshkent', r.comment ?? '', r.date.slice(0, 10), amount, created,
        ++docNo, r.category_id, r.client_id && clients.has(r.client_id) ? r.client_id : null, r.currency, internal, Number(r.custom_rate) || null, r.verified ? 1 : 0],
    )
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('cash_management_entries',$1,'finance2')`, [String(res.rows[0].id)])
    inserted++
  }
  await c.query('COMMIT')
  console.log('inserted reference expense entries', inserted)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
