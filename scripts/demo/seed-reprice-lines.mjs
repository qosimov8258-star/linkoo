// Adds the reference's product lines for repricing documents (our demo rows had empty `items`).
// Additive: creates repricing_reference_lines and INSERTs rows (registered in demo_seed_rows, domain 'left3').
// Rollback: rollback-left3.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const data = JSON.parse(fs.readFileSync(new URL('./data/reference-reprice-lines.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS repricing_reference_lines (
    repricing_id integer NOT NULL, position integer NOT NULL, product_id integer, name text NOT NULL, unit text NOT NULL DEFAULT '',
    amount double precision NOT NULL, old_price double precision, old_currency text, price double precision NOT NULL,
    PRIMARY KEY (repricing_id, position))`)
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())`)
  const products = (await c.query('SELECT id, name, unit FROM products WHERE COALESCE(deleted,0)=0')).rows
  const byName = new Map()
  for (const p of products) { if (!byName.has(p.name)) byName.set(p.name, p) }
  let added = 0, unmatched = 0
  for (const [id, doc] of Object.entries(data)) {
    const exists = (await c.query('SELECT 1 FROM repricings WHERE id=$1', [Number(id)])).rows.length
    if (!exists) continue
    let pos = 0
    for (const line of doc.products) {
      pos++
      const local = byName.get(line.name)
      if (!local) unmatched++
      const done = await c.query('SELECT 1 FROM repricing_reference_lines WHERE repricing_id=$1 AND position=$2', [Number(id), pos])
      if (done.rows.length) continue
      await c.query(
        `INSERT INTO repricing_reference_lines (repricing_id, position, product_id, name, unit, amount, old_price, old_currency, price) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [Number(id), pos, local?.id ?? null, line.name, local?.unit ?? '', line.amount, line.old_price, line.old_currency, line.price],
      )
      await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('repricing_reference_lines',$1,'left3')`, [`${id}:${pos}`])
      added++
    }
  }
  await c.query('COMMIT')
  console.log('added', added, 'unmatched products', unmatched)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
