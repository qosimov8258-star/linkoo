// Undoes apply-attendance-oct22.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query(`DELETE FROM attendance_recalc_days WHERE day IN (SELECT row_id FROM demo_seed_rows WHERE table_name='attendance_recalc_days' AND domain='inv-att')`)
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='attendance_recalc_days' AND domain='inv-att'`)
for (const r of (await c.query(`SELECT row_id, old_value FROM demo_seed_updates WHERE domain='inv-att' AND table_name='agent_routes'`)).rows) await c.query(`UPDATE agent_routes SET check_in = $1 WHERE id = $2`, [r.old_value, Number(r.row_id)])
await c.query(`DELETE FROM demo_seed_updates WHERE domain='inv-att'`)
await c.query('COMMIT')
console.log('restored')
await c.end()
