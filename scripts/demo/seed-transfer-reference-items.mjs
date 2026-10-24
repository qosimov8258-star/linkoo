// Copies the reference's transfer product lines (scripts/demo/data/transfer-reference-items.json, read-only GET) into
// transfer_reference_items. INSERT-only and idempotent; rows are registered in demo_seed_rows (domain 'final-ui').
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const data = JSON.parse(fs.readFileSync(new URL('./data/transfer-reference-items.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS transfer_reference_items (id SERIAL PRIMARY KEY, transfer_id INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0, product TEXT NOT NULL DEFAULT '', article TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '', quantity DOUBLE PRECISION NOT NULL DEFAULT 0, weight DOUBLE PRECISION NOT NULL DEFAULT 0, price DOUBLE PRECISION NOT NULL DEFAULT 0, series TEXT NOT NULL DEFAULT '')`)
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())`)
  let added = 0
  for (const [transferId, lines] of Object.entries(data)) {
    const have = (await c.query('SELECT 1 FROM transfer_reference_items WHERE transfer_id = $1 LIMIT 1', [Number(transferId)])).rows.length
    if (have) continue
    let position = 0
    for (const line of lines) {
      const inserted = await c.query(
        'INSERT INTO transfer_reference_items (transfer_id, position, product, article, unit, quantity, weight, price, series) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
        [Number(transferId), position++, line.product, line.article ?? '', line.unit ?? '', line.quantity, line.weight, line.price, line.series ?? ''],
      )
      await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('transfer_reference_items', $1, 'final-ui')`, [String(inserted.rows[0].id)])
      added++
    }
  }
  await c.query('COMMIT')
  console.log('added', added)
} catch (error) {
  await c.query('ROLLBACK')
  throw error
}
await c.end()
