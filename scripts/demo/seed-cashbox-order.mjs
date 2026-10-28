// Fills cashbox_reference_order with the reference's own cashbox sequence (GET finance/cashbox/?page_size=100), so the
// cashbox panel and the "Кассы" list are in the same order as the reference. INSERT-only, idempotent.
// Rollback: rollback-cashbox-order.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const ORDER = [21, 7, 42, 8, 9, 4, 38, 11, 37, 35, 29, 39, 25, 23, 14, 20, 22, 30, 36, 19, 17, 31, 32, 34, 33, 18, 28, 3, 15, 13, 12, 40, 5, 10, 1, 2, 24, 26, 27, 43, 41, 16]
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query('CREATE TABLE IF NOT EXISTS cashbox_reference_order (cashbox_id INTEGER PRIMARY KEY, seq INTEGER NOT NULL)')
  await c.query('CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())')
  let n = 0
  for (const [index, id] of ORDER.entries()) {
    const r = await c.query('INSERT INTO cashbox_reference_order (cashbox_id, seq) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, index + 1])
    if (r.rowCount) {
      n++
      await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('cashbox_reference_order', $1, 'qa5')`, [String(id)])
    }
  }
  await c.query('COMMIT')
  console.log('inserted', n)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
