// "Остаток": make every product/raw-material x warehouse quantity equal the reference's real stock
// (stock/all_balances/?stock=<id>, read-only). The delta between the reference and our documents is stored as
// additive starting quantities (stock_opening_balances) that lib/stock/sources.ts counts as value-less 'opening'
// movements, so costs / P&L / net cost are untouched. INSERT-only, registered in demo_seed_rows (domain 'parity'). Idempotent.
// Rollback: rollback-parity-stock.mjs
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const deltas = JSON.parse(fs.readFileSync(new URL('./data/parity-stock-deltas.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query('CREATE TABLE IF NOT EXISTS stock_opening_balances (id SERIAL PRIMARY KEY, warehouse TEXT NOT NULL, item_key TEXT NOT NULL, qty DOUBLE PRECISION NOT NULL)')
  const done = (await c.query(`SELECT count(*)::int n FROM demo_seed_rows WHERE table_name='stock_opening_balances' AND domain='parity'`)).rows[0].n
  if (done > 0) {
    console.log('already applied', done)
    await c.query('ROLLBACK')
    await c.end()
    process.exit(0)
  }
  let n = 0
  for (const d of deltas) {
    const qty = Math.round(d.delta * 1e6) / 1e6
    if (!qty) continue
    const res = await c.query('INSERT INTO stock_opening_balances (warehouse, item_key, qty) VALUES ($1,$2,$3) RETURNING id', [d.warehouse, d.key, qty])
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('stock_opening_balances',$1,'parity')`, [String(res.rows[0].id)])
    n++
  }
  await c.query('COMMIT')
  console.log('inserted', n)
} catch (e) {
  await c.query('ROLLBACK')
  throw e
}
await c.end()
