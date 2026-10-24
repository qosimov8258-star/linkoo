// Step 2 of the P&L alignment (user-approved 2026-10-24): inserts reference-sized demo customer return documents and
// the pnl_adjustments rows (salary accruals, write-off / stocktaking corrections) so P&L totals equal the reference's
// profit_loss figures for 2025 and 2026-01-01..2026-10-24. Rows are registered in demo_seed_rows (domain 'finance2').
// Rollback: rollback-pnl-returns.mjs (needs apply-pnl-returns-remove.mjs backups to restore the old demo returns).
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  if ((await c.query(`SELECT count(*)::int n FROM demo_seed_rows WHERE domain='finance2' AND table_name IN ('customer_returns','pnl_adjustments')`)).rows[0].n > 0) {
    console.log('already applied'); await c.query('ROLLBACK'); await c.end(); process.exit(0)
  }
  for (const col of ['quantity', 'unit_price', 'discount_percent', 'cost_price']) await c.query(`ALTER TABLE customer_returns ALTER COLUMN ${col} TYPE double precision`)
  await c.query(`CREATE TABLE IF NOT EXISTS pnl_adjustments (id SERIAL PRIMARY KEY, kind TEXT NOT NULL, entry_date TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, note TEXT NOT NULL DEFAULT '')`)

  // deterministic PRNG
  let seed = 20261024
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }

  const orders = (await c.query(`SELECT id, created_at FROM orders WHERE status IN ('Доставлено','В пути') ORDER BY id`)).rows
  const journal = new Set((await c.query(`SELECT DISTINCT name FROM cost_of_goods_rows`)).rows.map((r) => r.name))
  const products = (await c.query(`SELECT name FROM products WHERE deleted = 0 AND type IS NOT NULL AND type <> '' ORDER BY id`)).rows.map((r) => r.name).filter((n) => !journal.has(n))
  if (products.length < 12) throw new Error('not enough products without a cost journal')
  const picks = products.slice(0, 14)

  const makeDocs = (count, from, to, valueTotal, costTotal) => {
    const weights = Array.from({ length: count }, () => 0.2 + rnd() ** 2 * 3)
    const wsum = weights.reduce((a, b) => a + b, 0)
    const days = (Date.parse(to) - Date.parse(from)) / 86400000
    let valueLeft = valueTotal
    let costLeft = costTotal
    return weights.map((w, i) => {
      const last = i === count - 1
      const value = last ? valueLeft : Math.round((valueTotal * w) / wsum * 100) / 100
      const cost = last ? costLeft : Math.round((costTotal * w) / wsum * 100) / 100
      valueLeft -= value
      costLeft -= cost
      const qty = 1 + (i % 9)
      const date = new Date(Date.parse(from) + Math.floor(rnd() * days) * 86400000).toISOString().slice(0, 10)
      return { value, cost, qty, date }
    })
  }
  const docs = [
    ...makeDocs(84, '2025-01-05', '2025-12-28', 21765621896.084656, 557891383.655063),
    ...makeDocs(9, '2026-02-03', '2026-08-25', 10301366.8658333, 4604318.0093613),
  ]
  let n = 0
  for (const d of docs) {
    const order = orders[Math.floor(rnd() * orders.length)]
    const res = await c.query(
      `INSERT INTO customer_returns (order_id, product_name, quantity, unit_price, discount_percent, cost_price, currency, return_date, comment, created_by, created_at)
       VALUES ($1,$2,$3,$4,0,$5,'SUM',$6,'','Admin Ritm',$7) RETURNING id`,
      [order.id, picks[n % picks.length], d.qty, d.value / d.qty, d.cost / d.qty, d.date, `${d.date} 12:00:00`],
    )
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('customer_returns',$1,'finance2')`, [String(res.rows[0].id)])
    n++
  }
  // Calibration rows (the reference's salary module and its write-off / stocktaking cost basis are not available locally).
  const adjustments = [
    ['salary', '2025-12-31', 25531780, 'Зарплата: начисления 2025'],
    ['salary', '2026-09-30', 61624311.7942029, 'Зарплата: начисления сентября 2026'],
    ['writeoffs', '2025-12-31', 10566330.504655, 'Списания: поправка к документам'],
    ['writeoffs', '2026-01-02', -109231661.283309, 'Списания: поправка к документам'],
    ['inventory', '2025-12-31', -17384884.96, 'Инвентаризация: поправка'],
    ['inventory', '2026-01-02', -4489577.38, 'Инвентаризация: поправка'],
    ['net', '2025-12-31', 132886222, 'Чистая прибыль: поправка к референсу'],
  ]
  for (const [kind, date, amount, note] of adjustments) {
    const res = await c.query(`INSERT INTO pnl_adjustments (kind, entry_date, amount, note) VALUES ($1,$2,$3,$4) RETURNING id`, [kind, date, amount, note])
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('pnl_adjustments',$1,'finance2')`, [String(res.rows[0].id)])
  }
  await c.query('COMMIT')
  console.log('return docs', n, 'adjustments', adjustments.length)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
