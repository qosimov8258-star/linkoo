// Undoes seed-activity-feed.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query(`DELETE FROM activity_feed WHERE kind || '|' || id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name='activity_feed' AND domain='activity-feed')`)
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='activity_feed' AND domain='activity-feed'`)
await c.query('COMMIT')
console.log('restored')
await c.end()
