// The reference's attendance snapshot ("Перерасчет") was recalculated through 22 Oct 2026 (its dashboard now shows
// 0 on time / 1 late / 2450 not came / 387 day off for 1-22 Oct). Mirror it: add snapshot days 16-22 Oct (18 Oct is a
// Sunday) and give our own demo row (Admin Ritm, 2026-10-22) a late check-in. Old values: demo_seed_updates
// (domain 'inv-att'); new snapshot rows are registered in demo_seed_rows. Rollback: rollback-attendance-oct22.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_updates (table_name text, row_id text, column_name text, old_value jsonb, new_value jsonb, domain text, created_at timestamptz DEFAULT now())`)
  const days = ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']
  for (const day of days) {
    const off = new Date(`${day}T00:00:00`).getDay() === 0 ? 1 : 0
    const r = await c.query(`INSERT INTO attendance_recalc_days (day, day_off, calculated_at) VALUES ($1, $2, '2026-10-25 09:00:00') ON CONFLICT (day) DO NOTHING RETURNING day`, [day, off])
    if (r.rowCount) await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('attendance_recalc_days', $1, 'inv-att')`, [day])
  }
  const row = (await c.query(`SELECT id, check_in FROM agent_routes WHERE agent = 'Admin Ritm' AND route_date = '2026-10-22'`)).rows[0]
  if (row && row.check_in === '') {
    await c.query(`INSERT INTO demo_seed_updates (table_name,row_id,column_name,old_value,new_value,domain) VALUES ('agent_routes',$1,'check_in',$2,$3,'inv-att')`, [String(row.id), JSON.stringify(''), JSON.stringify('10:30')])
    await c.query(`UPDATE agent_routes SET check_in = '10:30' WHERE id = $1`, [row.id])
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log((await c.query(`SELECT count(*)::int n, max(day) mx FROM attendance_recalc_days WHERE day >= '2026-10-01'`)).rows[0])
await c.end()
