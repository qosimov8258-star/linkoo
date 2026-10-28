// Mirrors the reference's inventory #133 (created 2026-10-24 10:01:12 by Admin Ritm, warehouse 05,08,2025(1),
// confirmed, 1 x robot moshina, total 80140.372958) onto our own QA test row #133 (created via the app by admin, previously a
// cancelled "Arslan 111111" test). The item keeps diff=0 so stock is NOT counted twice (the +1 is already the
// mirrored supply #353). Old values: demo_seed_updates (domain 'inv133-mirror'). Rollback: rollback-inv133-mirror.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_updates (table_name text, row_id text, column_name text, old_value jsonb, new_value jsonb, domain text, created_at timestamptz DEFAULT now())`)
  const inv = (await c.query('SELECT * FROM stock_inventories WHERE id = 133')).rows[0]
  const done = (await c.query(`SELECT 1 FROM demo_seed_updates WHERE domain='inv133-mirror' LIMIT 1`)).rows.length
  // Guard: only touch our own QA test row (created through the app by 'admin', cancelled), or an already mirrored one.
  const ours = inv && ((inv.created_by === 'admin' && inv.status === 'canceled' && String(inv.created_at).startsWith('2026-10-24')) || done)
  if (!ours) throw new Error('inventory #133 is not our QA test row; refusing')
  const newInv = { warehouse: '05,08,2025(1)', inv_date: '2026-10-24', for_day_end: 0, type: 'fact_date', status: 'confirmed', comment: '', currency: 'SUM', total_price: 80140.372958, created_by: 'Admin Ritm', created_at: '2026-10-24 10:01:12', confirmed_at: '2026-10-24 10:01:12', confirmed_by: 'Admin Ritm', canceled_at: '', canceled_by: '' }
  const item = (await c.query('SELECT * FROM stock_inventory_items WHERE inventory_id = 133 ORDER BY id LIMIT 1')).rows[0]
  const newItem = { item_key: 'product:145', item_name: 'robot moshina', unit: 'dona', amount: 1, balance_amount: 0, diff: 0, cost: 80140.372958, total_price: 80140.372958, series: '', position: 0 }
  if (!done) {
    for (const [k, v] of Object.entries(newInv)) await c.query(`INSERT INTO demo_seed_updates (table_name,row_id,column_name,old_value,new_value,domain) VALUES ('stock_inventories','133',$1,$2,$3,'inv133-mirror')`, [k, JSON.stringify(inv[k]), JSON.stringify(v)])
    if (item) for (const [k, v] of Object.entries(newItem)) await c.query(`INSERT INTO demo_seed_updates (table_name,row_id,column_name,old_value,new_value,domain) VALUES ('stock_inventory_items',$1,$2,$3,$4,'inv133-mirror')`, [String(item.id), k, JSON.stringify(item[k]), JSON.stringify(v)])
  }
  const sets = Object.keys(newInv).map((k, i) => `${k} = $${i + 1}`).join(', ')
  await c.query(`UPDATE stock_inventories SET ${sets} WHERE id = 133`, Object.values(newInv))
  if (item) {
    const s2 = Object.keys(newItem).map((k, i) => `${k} = $${i + 1}`).join(', ')
    await c.query(`UPDATE stock_inventory_items SET ${s2} WHERE id = ${Number(item.id)}`, Object.values(newItem))
  }
  await c.query('COMMIT')
  console.log('mirrored inventory #133')
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
