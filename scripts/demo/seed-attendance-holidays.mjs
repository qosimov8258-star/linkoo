// The reference's holiday sets that differ from "every Sunday" (staff/holiday): Nov 2025 = Mondays 3/10/17/24,
// Dec 2025 = Saturdays and Sundays. Months without rows keep the default (Sundays). Insert-only, idempotent;
// rows are registered in demo_seed_rows (domain 'attendance-holidays'). Rollback: rollback-attendance-holidays.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
const sets = [[2025, 10, [3, 10, 17, 24]], [2025, 11, [6, 7, 13, 14, 20, 21, 27, 28]]]
let n = 0
try {
  for (const [year, month, days] of sets) {
    const has = await c.query('SELECT 1 FROM attendance_weekend_days WHERE year=$1 AND month=$2 LIMIT 1', [year, month])
    if (has.rowCount) continue
    for (const day of days) {
      const r = await c.query('INSERT INTO attendance_weekend_days (year, month, day) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id', [year, month, day])
      if (r.rowCount) { n++; await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('attendance_weekend_days', $1, 'attendance-holidays')`, [String(r.rows[0].id)]) }
    }
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log('inserted', n)
await c.end()
