// Corrects the October-2026 DEMO visits (user-approved 2026-10-24). Scope: agent_visits rows registered in
// demo_seed_rows (domain 'field-ops') only.
//  - 2026-10-01..2026-10-21 demo visits are removed ("Visits by days" shows only Admin Ritm, like the reference);
//  - the 2026-10-22 Admin Ritm visit becomes a refusal (reference: one refusal that day).
// Backup: demo_seed_backup_agent_visits (+ _registry). Rollback: rollback-october-visits.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  const scope = `visit_date >= '2026-10-01' AND id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name='agent_visits' AND domain='field-ops')`
  if (!(await c.query(`SELECT to_regclass('demo_seed_backup_agent_visits') AS t`)).rows[0].t) {
    await c.query(`CREATE TABLE demo_seed_backup_agent_visits AS SELECT * FROM agent_visits WHERE ${scope}`)
    await c.query(`CREATE TABLE demo_seed_backup_agent_visits_registry AS SELECT * FROM demo_seed_rows WHERE table_name='agent_visits' AND domain='field-ops' AND row_id IN (SELECT id::text FROM demo_seed_backup_agent_visits)`)
  }
  const gone = await c.query(`DELETE FROM agent_visits WHERE visit_date BETWEEN '2026-10-01' AND '2026-10-21' AND id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name='agent_visits' AND domain='field-ops') RETURNING id`)
  if (gone.rows.length) await c.query(`DELETE FROM demo_seed_rows WHERE table_name='agent_visits' AND domain='field-ops' AND row_id = ANY($1)`, [gone.rows.map((r) => String(r.id))])
  const upd = await c.query(`UPDATE agent_visits SET result='refusal', refusal_type='Другая причин' WHERE id=8608 AND visit_date='2026-10-22' AND agent='Admin Ritm' AND result='visit' RETURNING id`)

  // --- agent_routes (October demo rows) + attendance snapshot days -------------------------------------------------
  const rScope = `route_date >= '2026-10-01' AND id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name='agent_routes' AND domain='field-ops')`
  if (!(await c.query(`SELECT to_regclass('demo_seed_backup_agent_routes') AS t`)).rows[0].t) {
    await c.query(`CREATE TABLE demo_seed_backup_agent_routes AS SELECT * FROM agent_routes WHERE ${rScope}`)
    await c.query(`CREATE TABLE demo_seed_backup_agent_routes_registry AS SELECT * FROM demo_seed_rows WHERE table_name='agent_routes' AND domain='field-ops' AND row_id IN (SELECT id::text FROM demo_seed_backup_agent_routes)`)
  }
  const goneRoutes = await c.query(`DELETE FROM agent_routes WHERE route_date BETWEEN '2026-10-01' AND '2026-10-21' AND id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name='agent_routes' AND domain='field-ops') RETURNING id`)
  if (goneRoutes.rows.length) await c.query(`DELETE FROM demo_seed_rows WHERE table_name='agent_routes' AND domain='field-ops' AND row_id = ANY($1)`, [goneRoutes.rows.map((r) => String(r.id))])
  // the 22 Oct visit of Admin Ritm is a refusal: keep the per-day summary consistent
  const routeUpd = await c.query(`UPDATE agent_routes SET outside_refused = 1 WHERE route_date='2026-10-22' AND agent='Admin Ritm' AND outside_visited = 1 AND outside_refused = 0 RETURNING id`)
  // "Перерасчет" snapshot: the reference counted attendance only for 1-15 Oct (Sundays are days off, 1 Oct is a working day)
  await c.query(`CREATE TABLE IF NOT EXISTS attendance_recalc_days (day TEXT PRIMARY KEY, day_off INTEGER NOT NULL DEFAULT 0, calculated_at TEXT NOT NULL DEFAULT '')`)
  let snap = 0
  for (let d = 1; d <= 15; d++) {
    const day = `2026-10-${String(d).padStart(2, '0')}`
    const off = new Date(`${day}T00:00:00`).getDay() === 0 ? 1 : 0
    const ins = await c.query(`INSERT INTO attendance_recalc_days (day, day_off, calculated_at) VALUES ($1,$2,'2026-10-15 23:00:00') ON CONFLICT (day) DO NOTHING RETURNING day`, [day, off])
    if (ins.rows.length) {
      snap++
      await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('attendance_recalc_days', $1, 'field-ops')`, [day])
    }
  }
  await c.query('COMMIT')
  console.log('visits removed', gone.rows.length, 'refusal set', upd.rows.length, '| routes removed', goneRoutes.rows.length, 'route refused', routeUpd.rows.length, '| snapshot days added', snap)
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log((await c.query(`SELECT visit_date, count(*)::int n, min(result) r FROM agent_visits WHERE visit_date >= '2026-10-01' GROUP BY 1 ORDER BY 1`)).rows)
await c.end()
