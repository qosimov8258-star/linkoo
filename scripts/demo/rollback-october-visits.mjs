// Restores the October-2026 demo visits removed/changed by apply-october-visits.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query(`DELETE FROM agent_visits WHERE id IN (SELECT id FROM demo_seed_backup_agent_visits)`)
await c.query(`INSERT INTO agent_visits SELECT * FROM demo_seed_backup_agent_visits`)
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='agent_visits' AND domain='field-ops' AND row_id IN (SELECT row_id FROM demo_seed_backup_agent_visits_registry)`)
await c.query(`INSERT INTO demo_seed_rows SELECT * FROM demo_seed_backup_agent_visits_registry`)
if ((await c.query(`SELECT to_regclass('demo_seed_backup_agent_routes') AS t`)).rows[0].t) {
  await c.query(`DELETE FROM agent_routes WHERE id IN (SELECT id FROM demo_seed_backup_agent_routes)`)
  await c.query(`INSERT INTO agent_routes SELECT * FROM demo_seed_backup_agent_routes`)
  await c.query(`DELETE FROM demo_seed_rows WHERE table_name='agent_routes' AND domain='field-ops' AND row_id IN (SELECT row_id FROM demo_seed_backup_agent_routes_registry)`)
  await c.query(`INSERT INTO demo_seed_rows SELECT * FROM demo_seed_backup_agent_routes_registry`)
}
if ((await c.query(`SELECT to_regclass('attendance_recalc_days') AS t`)).rows[0].t) {
  await c.query(`DELETE FROM attendance_recalc_days WHERE day IN (SELECT row_id FROM demo_seed_rows WHERE table_name='attendance_recalc_days' AND domain='field-ops')`)
  await c.query(`DELETE FROM demo_seed_rows WHERE table_name='attendance_recalc_days' AND domain='field-ops'`)
}
await c.query('COMMIT')
console.log('restored')
await c.end()
