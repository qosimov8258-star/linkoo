// Drops the additive reference tables created by apply-parity-netcost.mjs (the list falls back to the ledger-derived records)
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query('DROP TABLE IF EXISTS net_cost_reference_rows')
await c.query('DROP TABLE IF EXISTS net_cost_reference_totals')
await c.query(`DELETE FROM demo_seed_rows WHERE table_name = 'net_cost_reference_rows'`)
await c.query('COMMIT')
console.log('dropped')
await c.end()
