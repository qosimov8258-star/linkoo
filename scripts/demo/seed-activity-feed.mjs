// Seeds the reference's "Активность" feed (market/today_plan_stat + market/rejection of app.linko.uz: orders, deliveries,
// payments, reports, rejections) into activity_feed. Insert-only and idempotent; inserted keys are registered in
// demo_seed_rows (domain 'activity-feed').
// Rollback: rollback-activity-feed.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(fs.readFileSync(new URL('./data/activity-feed-reference.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query(`CREATE TABLE IF NOT EXISTS activity_feed (kind TEXT NOT NULL, id BIGINT NOT NULL, user_id INTEGER, user_name TEXT NOT NULL DEFAULT '', at TEXT NOT NULL, range_date TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', market_id INTEGER, market_name TEXT, extra TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (kind, id))`)
await c.query(`CREATE INDEX IF NOT EXISTS activity_feed_range_idx ON activity_feed (kind, range_date)`)
await c.query('BEGIN')
let n = 0
try {
  for (const [kind, id, userId, userName, at, text, marketId, marketName, extra] of rows) {
    const range = at.slice(0, 10)
    const r = await c.query(
      `INSERT INTO activity_feed (kind, id, user_id, user_name, at, range_date, text, market_id, market_name, extra) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
      [kind, id, userId, userName, at, range, text ?? '', marketId, marketName, JSON.stringify(extra)],
    )
    if (r.rowCount) { n++; await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('activity_feed', $1, 'activity-feed')`, [`${kind}|${id}`]) }
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log('inserted', n)
await c.end()
