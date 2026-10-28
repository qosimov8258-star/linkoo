// Seeds the reference's "Посещения на работу" cells (staff/attendance API of app.linko.uz, months with data from
// 2025-01 to 2026-10) into attendance_cells. Insert-only and idempotent; inserted keys are registered in
// demo_seed_rows (domain 'attendance-cells'). Rollback: rollback-attendance-cells.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(fs.readFileSync(new URL('./data/attendance-cells-reference.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query(`CREATE TABLE IF NOT EXISTS attendance_cells (employee_id INTEGER NOT NULL, day TEXT NOT NULL, type TEXT NOT NULL, comment TEXT, time TEXT, late_minutes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (employee_id, day))`)
await c.query('BEGIN')
let n = 0
try {
  const ids = new Set((await c.query('SELECT id FROM employees')).rows.map((r) => r.id))
  for (const [id, day, type, comment, time, late] of rows) {
    if (!ids.has(id)) continue
    const r = await c.query(`INSERT INTO attendance_cells (employee_id, day, type, comment, time, late_minutes) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [id, day, type, comment, time, late])
    if (r.rowCount) { n++; await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('attendance_cells', $1, 'attendance-cells')`, [`${id}|${day}`]) }
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log('inserted', n)
await c.end()
