// Seeds the reference's agent day card header numbers (market/detail_plan + agent_plans statuses of app.linko.uz) into
// agent_day_plans. Insert-only and idempotent; inserted keys are registered in demo_seed_rows (domain 'agent-day-plans').
// Rollback: rollback-agent-day-plans.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(fs.readFileSync(new URL('./data/agent-day-plans-reference.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query(`CREATE TABLE IF NOT EXISTS agent_day_plans (user_id INTEGER NOT NULL, day TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (user_id, day))`)
await c.query('BEGIN')
let n = 0
try {
  for (const [userId, day, data] of rows) {
    const r = await c.query(`INSERT INTO agent_day_plans (user_id, day, data) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [userId, day, JSON.stringify(data)])
    if (r.rowCount) { n++; await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('agent_day_plans', $1, 'agent-day-plans')`, [`${userId}|${day}`]) }
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log('inserted', n)
await c.end()
