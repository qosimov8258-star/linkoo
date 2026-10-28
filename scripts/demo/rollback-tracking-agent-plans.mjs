// Undoes seed-tracking-agent-plans.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query(`DELETE FROM tracking_agent_plans p USING demo_seed_rows d WHERE d.table_name = 'tracking_agent_plans' AND d.domain = 'tracking-agent-plans' AND d.row_id = p.user_id::text || '|' || p.day`)
await c.query(`DELETE FROM demo_seed_rows WHERE table_name = 'tracking_agent_plans' AND domain = 'tracking-agent-plans'`)
await c.query('COMMIT')
console.log('restored')
await c.end()
