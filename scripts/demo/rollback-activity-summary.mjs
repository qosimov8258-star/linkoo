// Undoes seed-activity-summary.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
const del = (table, keyExpr) => c.query(`DELETE FROM ${table} WHERE ${keyExpr} IN (SELECT row_id FROM demo_seed_rows WHERE table_name='${table}' AND domain='activity-summary')`)
await del('activity_summary_days', 'day')
await del('activity_agent_days', `day || '|' || agent_id::text`)
await del('activity_agent_order', 'agent_id::text')
await del('activity_delivery_days', 'id::text')
await c.query(`DELETE FROM demo_seed_rows WHERE domain='activity-summary'`)
await c.query('COMMIT')
console.log('restored')
await c.end()
