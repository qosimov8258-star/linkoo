// "Работа с инвентарем": the reference shows Одобрено 0 / Не одобрено 35, our 35 demo items had 13 approved.
// Only our own demo items (registered in demo_seed_rows) are touched; old values go to demo_seed_updates (domain 'parity-inventory').
// Rollback: rollback-parity-inventory-items.mjs
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_updates (table_name text, row_id text, column_name text, old_value jsonb, new_value jsonb, domain text, created_at timestamptz DEFAULT now())`)
  const rows = (
    await c.query(
      `SELECT id, approved FROM inventory_items WHERE approved = 1 AND id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name='inventory_items')`,
    )
  ).rows
  for (const r of rows) {
    await c.query(
      `INSERT INTO demo_seed_updates (table_name,row_id,column_name,old_value,new_value,domain) VALUES ('inventory_items',$1,'approved',$2,'0','parity-inventory')`,
      [String(r.id), JSON.stringify(r.approved)],
    )
    await c.query('UPDATE inventory_items SET approved = 0 WHERE id = $1', [r.id])
  }
  await c.query('COMMIT')
  console.log('unapproved', rows.length)
} catch (e) {
  await c.query('ROLLBACK')
  throw e
}
console.log((await c.query('SELECT count(*) FILTER (WHERE approved=1)::int approved, count(*)::int total FROM inventory_items')).rows)
await c.end()
