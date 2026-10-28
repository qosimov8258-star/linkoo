// The reference's market/way/ list keeps the agents in the order of the agent plan; the colour of a panel tab other than
// "Все" is assigned by the position inside that list. Seeds that order (insert-only, idempotent) into
// tracking_way_order; rows are registered in demo_seed_rows (domain 'tracking-way-order'). Rollback: rollback-tracking-way-order.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const ids = JSON.parse(fs.readFileSync(new URL('./data/tracking-way-order-reference.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('CREATE TABLE IF NOT EXISTS tracking_way_order (id INTEGER PRIMARY KEY, pos INTEGER NOT NULL)')
await c.query('BEGIN')
let n = 0
try {
  for (const [pos, id] of ids.entries()) {
    const r = await c.query('INSERT INTO tracking_way_order (id, pos) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, pos])
    if (r.rowCount) { n++; await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('tracking_way_order', $1, 'tracking-way-order')`, [String(id)]) }
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log('inserted', n)
await c.end()
