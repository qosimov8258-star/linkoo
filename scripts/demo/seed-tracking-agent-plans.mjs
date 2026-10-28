// Seeds the clients of an agent's day of the reference's tracking map (market/agent_plans/{id}/ and market/detail_plan/ of app.linko.uz, every
// agent and day that has a plan) into tracking_agent_plans. Insert-only and idempotent; inserted keys are registered in demo_seed_rows
// (domain 'tracking-agent-plans'). Rollback: rollback-tracking-agent-plans.mjs
import pg from 'pg'
import fs from 'fs'
import zlib from 'zlib'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./data/tracking-agent-plans-reference.json.gz', import.meta.url))).toString('utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query(`CREATE TABLE IF NOT EXISTS tracking_agent_plans (user_id INTEGER NOT NULL, day TEXT NOT NULL, plans TEXT NOT NULL, stats TEXT NOT NULL, PRIMARY KEY (user_id, day))`)
await c.query('BEGIN')
let n = 0
try {
  for (const [userId, day, plans, stats] of rows) {
    const r = await c.query(`INSERT INTO tracking_agent_plans (user_id, day, plans, stats) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [userId, day, JSON.stringify(plans), JSON.stringify(stats)])
    if (r.rowCount) { n++; await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('tracking_agent_plans', $1, 'tracking-agent-plans')`, [`${userId}|${day}`]) }
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log('inserted', n)
await c.end()
