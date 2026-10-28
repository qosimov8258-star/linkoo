// "Остаток" Бронь parity (user-approved reference alignment, 2026-10-26): the reference reserves 12 more units than our
// documents explain (client equipment / other holds). Rows go to stock_reserved_adjustments (counted as Бронь only, never as
// stock movements) and are registered in demo_seed_rows (domain 'stock-cols'); rollback-stock-cols.mjs removes exactly them.
// Order/transfer rules ("Не подтвержден" orders, "ожидает"/"потвержден" transfers) live in lib/stock/sources.ts.
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
const ROWS = [
  // [warehouse as named locally, product id, qty]
  ['toshkent', 170, 1], // bagaj
  ['Яндекс Лавка', 165, 1], // coca-cola
  ['05,08,2025(1)', 189, 3], // g'ilof
  ['toshkent', 189, -1], // g'ilof (our waiting transfer holds 1 at toshkent, the reference holds it at 05,08,2025(1))
  ['toshkent', 590, 1], // Marojna Xaladilnik
  ['suhrob sklad', 588, 1], // Polka Xrusti
  ['toshkent', 169, 1], // shkaf
  ['toshkent', 166, 2], // sprayt
  ['toshkent', 341, 3], // test inventar
]
await c.query('BEGIN')
try {
  await c.query('CREATE TABLE IF NOT EXISTS stock_reserved_adjustments (id SERIAL PRIMARY KEY, warehouse TEXT NOT NULL, item_key TEXT NOT NULL, qty DOUBLE PRECISION NOT NULL)')
  await c.query("CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())")
  let added = 0
  for (const [warehouse, productId, qty] of ROWS) {
    const key = `product:${productId}`
    const wh = (await c.query('SELECT name FROM warehouses WHERE lower(btrim(name)) = lower(btrim($1)) ORDER BY id LIMIT 1', [warehouse])).rows[0]
    if (!wh) throw new Error('warehouse not found: ' + warehouse)
    const exists = (await c.query(`SELECT 1 FROM stock_reserved_adjustments a JOIN demo_seed_rows d ON d.table_name='stock_reserved_adjustments' AND d.row_id=a.id::text AND d.domain='stock-cols' WHERE a.warehouse=$1 AND a.item_key=$2`, [wh.name, key])).rows.length
    if (exists) continue
    const id = (await c.query('INSERT INTO stock_reserved_adjustments (warehouse, item_key, qty) VALUES ($1,$2,$3) RETURNING id', [wh.name, key, qty])).rows[0].id
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('stock_reserved_adjustments',$1,'stock-cols')`, [String(id)])
    added++
  }
  await c.query('COMMIT')
  console.log('added', added)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
