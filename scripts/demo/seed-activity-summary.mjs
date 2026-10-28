// Seeds the reference's "Активность" counters and agent strip (market/today_plan_stat_sum and market/agent/done_plan of
// app.linko.uz, one row per day - both are additive per day), the strip's agent order and the day each delivery is filtered
// by (the creation day of its order). Insert-only and idempotent; inserted keys are registered in demo_seed_rows
// (domain 'activity-summary'). Rollback: rollback-activity-summary.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const data = JSON.parse(fs.readFileSync(new URL('./data/activity-summary-reference.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query(`CREATE TABLE IF NOT EXISTS activity_summary_days (day TEXT PRIMARY KEY, order_count INTEGER NOT NULL DEFAULT 0, order_total DOUBLE PRECISION NOT NULL DEFAULT 0, tx_count INTEGER NOT NULL DEFAULT 0, tx_total DOUBLE PRECISION NOT NULL DEFAULT 0, delivery_count INTEGER NOT NULL DEFAULT 0, report_done INTEGER NOT NULL DEFAULT 0, rejection_count INTEGER NOT NULL DEFAULT 0, return_count INTEGER NOT NULL DEFAULT 0, return_total DOUBLE PRECISION NOT NULL DEFAULT 0)`)
await c.query(`CREATE TABLE IF NOT EXISTS activity_agent_days (day TEXT NOT NULL, agent_id INTEGER NOT NULL, sales DOUBLE PRECISION NOT NULL DEFAULT 0, visit_markets DOUBLE PRECISION NOT NULL DEFAULT 0, PRIMARY KEY (day, agent_id))`)
await c.query(`CREATE TABLE IF NOT EXISTS activity_agent_order (agent_id INTEGER PRIMARY KEY, position INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '')`)
await c.query(`CREATE TABLE IF NOT EXISTS activity_delivery_days (id BIGINT PRIMARY KEY, day TEXT NOT NULL)`)
await c.query(`ALTER TABLE activity_summary_days ADD COLUMN IF NOT EXISTS return_count INTEGER NOT NULL DEFAULT 0`)
await c.query(`ALTER TABLE activity_summary_days ADD COLUMN IF NOT EXISTS return_total DOUBLE PRECISION NOT NULL DEFAULT 0`)
await c.query(`ALTER TABLE activity_agent_order ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`)
await c.query('BEGIN')
const counts = { summary: 0, agentDays: 0, agents: 0, deliveries: 0 }
const reg = (table, key) => c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ($1, $2, 'activity-summary')`, [table, key])
try {
  for (const row of data.summary) {
    const r = await c.query(`INSERT INTO activity_summary_days (day, order_count, order_total, tx_count, tx_total, delivery_count, report_done, rejection_count, return_count, return_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, row)
    if (r.rowCount) { counts.summary++; await reg('activity_summary_days', row[0]) }
  }
  for (const row of data.agentDays) {
    const r = await c.query(`INSERT INTO activity_agent_days (day, agent_id, sales, visit_markets) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, row)
    if (r.rowCount) { counts.agentDays++; await reg('activity_agent_days', `${row[0]}|${row[1]}`) }
  }
  for (const [id, name, position] of data.agents) {
    const r = await c.query(`INSERT INTO activity_agent_order (agent_id, position, name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [id, position, name])
    if (r.rowCount) { counts.agents++; await reg('activity_agent_order', String(id)) }
  }
  for (const [id, day] of data.deliveryDays) {
    const r = await c.query(`INSERT INTO activity_delivery_days (id, day) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, day])
    if (r.rowCount) { counts.deliveries++; await reg('activity_delivery_days', String(id)) }
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log('inserted', counts)
await c.end()
