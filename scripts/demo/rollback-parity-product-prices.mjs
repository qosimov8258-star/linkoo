// Drops product_reference_prices (made by apply-parity-product-prices.mjs)
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query('DROP TABLE IF EXISTS product_reference_prices')
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='product_reference_prices'`)
await c.query('COMMIT')
console.log('dropped')
await c.end()
