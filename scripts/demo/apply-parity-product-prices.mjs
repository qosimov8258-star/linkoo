// "Формирование цен": the reference's own net cost / min / max price / price-updated date per product
// (stock/products_net_costs/, read-only) stored additively in product_reference_prices; lib/products-catalog.ts lets them
// win over the demo-made values. INSERT-only, registered in demo_seed_rows (domain 'parity'). Idempotent.
// Rollback: rollback-parity-product-prices.mjs
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(fs.readFileSync(new URL('./data/parity-product-prices.json', import.meta.url), 'utf8'))
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const ruDate = (iso) => {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : 'Не установлена'
}
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS product_reference_prices (product_id INTEGER PRIMARY KEY, net_cost DOUBLE PRECISION NOT NULL DEFAULT 0, min_price DOUBLE PRECISION NOT NULL DEFAULT 0, max_price DOUBLE PRECISION NOT NULL DEFAULT 0, price_updated TEXT NOT NULL DEFAULT '')`)
  const done = (await c.query(`SELECT count(*)::int n FROM demo_seed_rows WHERE table_name='product_reference_prices' AND domain='parity'`)).rows[0].n
  if (done > 0) {
    console.log('already applied', done)
    await c.query('ROLLBACK')
    await c.end()
    process.exit(0)
  }
  let n = 0
  for (const r of rows) {
    await c.query(
      `INSERT INTO product_reference_prices (product_id, net_cost, min_price, max_price, price_updated) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (product_id) DO NOTHING`,
      [r.id, Number(r.net_cost), Number(r.min_price), Number(r.max_price), ruDate(r.price_updated)],
    )
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('product_reference_prices',$1,'parity')`, [String(r.id)])
    n++
  }
  await c.query('COMMIT')
  console.log('inserted', n)
} catch (e) {
  await c.query('ROLLBACK')
  throw e
}
await c.end()
