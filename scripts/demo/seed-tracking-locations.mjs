// Seeds the tracker points of the reference's market/location/ API (app.linko.uz, every agent) into tracking_locations, the track an agent's
// card draws on the tracking map. Insert-only and idempotent; inserted ids are registered in demo_seed_rows (domain 'tracking-locations').
// Rollback: rollback-tracking-locations.mjs
import pg from 'pg'
import fs from 'fs'
import zlib from 'zlib'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const agents = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./data/tracking-locations-reference.json.gz', import.meta.url))).toString('utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query(`CREATE TABLE IF NOT EXISTS tracking_locations (id BIGINT PRIMARY KEY, user_id INTEGER NOT NULL, lat DOUBLE PRECISION NOT NULL, lon DOUBLE PRECISION NOT NULL, battery DOUBLE PRECISION, registered_at TEXT NOT NULL)`)
await c.query(`CREATE INDEX IF NOT EXISTS tracking_locations_user_time ON tracking_locations (user_id, registered_at)`)
await c.query('BEGIN')
let n = 0
try {
  for (const [userId, rows] of Object.entries(agents)) {
    for (let i = 0; i < rows.length; i += 5000) {
      const part = rows.slice(i, i + 5000)
      const r = await c.query(
        `WITH ins AS (
           INSERT INTO tracking_locations (id, user_id, lat, lon, battery, registered_at)
           SELECT * FROM unnest($1::bigint[], $2::int[], $3::float8[], $4::float8[], $5::float8[], $6::text[]) ON CONFLICT DO NOTHING RETURNING id
         )
         INSERT INTO demo_seed_rows (table_name, row_id, domain) SELECT 'tracking_locations', id::text, 'tracking-locations' FROM ins`,
        [part.map((x) => x[0]), part.map(() => Number(userId)), part.map((x) => x[1]), part.map((x) => x[2]), part.map((x) => x[3]), part.map((x) => x[4])],
      )
      n += r.rowCount
    }
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log('inserted', n)
await c.end()
