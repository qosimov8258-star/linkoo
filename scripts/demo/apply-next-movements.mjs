// "Движение товаров" parity (user-approved 2026-10-24): the reference lists 2017 lines from stock/barcode_history/.
// They are stored (INSERT only) in the new table stock_movement_reference_rows and read by lib/stock-plan-movements.ts for that
// tab only; stock balances/costs/P&L are not touched. Rollback: rollback-next-movements.mjs (drops that table).
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(fs.readFileSync(new URL('./data/next-barcode-history.json', import.meta.url), 'utf8'))
const KIND = {
  'supply|In': 'supply',
  'supply return product|Out': 'supply_return',
  'order|Out': 'order',
  'order return|In': 'return',
  'writeoff|Out': 'writeoff',
  'stock_transfer|In': 'transfer_in',
  'stock_transfer|Out': 'transfer_out',
  'manufacture return|In': 'none_in', // the reference labels production lines "Партия"
  'manufacture writeoff|Out': 'none_out',
  'gear|In': 'inventory_in',
  'gear|Out': 'inventory_out',
}
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS stock_movement_reference_rows (
    ref_id integer PRIMARY KEY, day text, warehouse text, item_key text, qty double precision, kind text, doc_type text,
    doc_id integer, doc_no integer, is_defect integer, ref_name text, ref_unit text, created_at text)`)
  let n = 0
  for (const r of rows) {
    const kind = KIND[`${r.gtype}|${r.type}`]
    if (!kind) throw new Error('unmapped ' + r.gtype + '|' + r.type)
    // the reference UI shows the API timestamp as is (no time-zone shift)
    const local = r.created.slice(0, 19)
    const res = await c.query(
      `INSERT INTO stock_movement_reference_rows (ref_id, day, warehouse, item_key, qty, kind, doc_type, doc_id, doc_no, is_defect, ref_name, ref_unit, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (ref_id) DO NOTHING RETURNING ref_id`,
      [r.id, local.slice(0, 10), r.stock, `product:${r.product_id}`, Number(r.amount), kind, r.gtype.replace(/ /g, '_'), r.gid, r.parent ?? r.gid, r.defect ? 1 : 0, r.product, r.unit, local.slice(0, 19).replace('T', ' ')],
    )
    if (res.rows.length) {
      await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('stock_movement_reference_rows',$1,'nextdata-mv')`, [String(r.id)])
      n++
    }
  }
  await c.query('COMMIT')
  console.log('inserted', n, 'of', rows.length)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
