// The reference's attendance snapshot ("Перерасчет") now covers 1-25 Oct 2026 (staff/attendance: 23-24 Oct "not_come",
// 25 Oct a day off). Mirror it: add snapshot days 23-25 Oct (25 Oct is a Sunday). Insert-only, idempotent; new rows are
// registered in demo_seed_rows (domain 'inv-att-25'). Rollback: rollback-attendance-oct25.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  for (const day of ['2026-10-23', '2026-10-24', '2026-10-25']) {
    const off = new Date(`${day}T00:00:00`).getDay() === 0 ? 1 : 0
    const r = await c.query(`INSERT INTO attendance_recalc_days (day, day_off, calculated_at) VALUES ($1, $2, '2026-10-26 09:00:00') ON CONFLICT (day) DO NOTHING RETURNING day`, [day, off])
    if (r.rowCount) await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('attendance_recalc_days', $1, 'inv-att-25')`, [day])
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log((await c.query(`SELECT count(*)::int n, max(day) mx FROM attendance_recalc_days WHERE day >= '2026-10-01'`)).rows[0])
await c.end()
