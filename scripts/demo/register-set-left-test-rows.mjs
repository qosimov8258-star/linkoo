// Registers the attendance_recalc_days rows created while testing POST /api/attendance-recalc (Jan 2020) in demo_seed_rows (domain 'set-left').
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
const r = await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain)
  SELECT 'attendance_recalc_days', day, 'set-left' FROM attendance_recalc_days WHERE day LIKE '2020-01-%'
  AND NOT EXISTS (SELECT 1 FROM demo_seed_rows d WHERE d.table_name='attendance_recalc_days' AND d.row_id = attendance_recalc_days.day)`)
console.log('registered', r.rowCount)
await c.end()
