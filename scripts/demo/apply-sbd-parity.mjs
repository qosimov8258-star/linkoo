// "Остаток на определенную дату" parity: mirrors the reference's stock report history.
// scripts/demo/data/sbd-reference-days.json holds, per day, every product that moved that day with the reference's
// per-kind quantities/values (read from its stats/stock/products API with begin_date = end_date = day).
// Creates (INSERT-only, registered in demo_seed_rows domain 'sbd-parity'; rollback: rollback-sbd-parity.mjs):
//   stock_report_ref_moves  (day, warehouse, item_key, kind, qty, value, doc_type, doc_id, name)
//   stock_report_ref_marks  (day, item_key, end_qty, end_value)  valuation after each movement day
//   stock_report_ref_meta   (cutoff = last mirrored day; our own ledger rows after it stay live)
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const days = JSON.parse(fs.readFileSync(new URL('./data/sbd-reference-days.json', import.meta.url), 'utf8'))
// Per warehouse (reference `stock=<id>` filter), only on the days something moved: { names: {id: name}, data: {id: {day: rows}} }.
const whFile = new URL('./data/sbd-reference-warehouse-days.json', import.meta.url)
const byWarehouse = fs.existsSync(whFile) ? JSON.parse(fs.readFileSync(whFile, 'utf8')) : null
// Reference group_by=stock windows ({ stock: {day: rows(name = warehouse)} }): per-warehouse totals the report must reproduce.
const stockFile = new URL('./data/sbd-reference-stock-days.json', import.meta.url)
const stockGroups = fs.existsSync(stockFile) ? JSON.parse(fs.readFileSync(stockFile, 'utf8')).stock : null
const CUTOFF = '2026-10-24'
const DOC = { supply: 'supplier_incomings', supply_return: 'supplier_returns', writeoff: 'write_offs', transfer_in: 'internal_transfers', transfer_out: 'internal_transfers', manufacture_in: 'production_movements', manufacture_out: 'production_movements', inventory_in: 'stock_inventories', inventory_out: 'stock_inventories', order: 'orders', return: 'orders', none_in: 'production_movements', none_out: 'production_movements', residual: 'stock_inventories' }

function normalize(days, warehouse = null) {
  const moves = []
  const marks = []
  for (const [day, rows] of Object.entries(days)) {
    for (const r of rows) {
      const g = (k) => r[k] || [0, 0]
      const add = (kind, q, v) => { if (Math.abs(q) > 1e-9 || Math.abs(v) > 1e-9) moves.push({ day, id: r.id, name: r.name, kind, qty: q, value: v, warehouse }) }
      add('supply', ...g('supply')); add('supply_return', ...g('supply_return')); add('order', ...g('order')); add('return', ...g('return')); add('writeoff', ...g('writeoff'))
      add('inventory_in', ...g('in_inventory')); add('inventory_out', ...g('out_inventory')); add('manufacture_in', ...g('in_manufacture')); add('manufacture_out', ...g('out_manufacture')); add('transfer_in', ...g('in_transfer')); add('transfer_out', ...g('out_transfer'))
      // in_none / out_none are the reference's "Прочий" totals (inventory + production + transfers + the rest).
      add('none_in', g('in_none')[0] - g('in_inventory')[0] - g('in_manufacture')[0] - g('in_transfer')[0], g('in_none')[1] - g('in_inventory')[1] - g('in_manufacture')[1] - g('in_transfer')[1])
      add('none_out', g('out_none')[0] - g('out_inventory')[0] - g('out_manufacture')[0] - g('out_transfer')[0], g('out_none')[1] - g('out_inventory')[1] - g('out_manufacture')[1] - g('out_transfer')[1])
      const T = ['supply', 'supply_return', 'order', 'return', 'writeoff'].reduce((a, k) => [a[0] + g(k)[0], a[1] + g(k)[1]], [0, 0])
      const tq = T[0] + g('in_none')[0] + g('out_none')[0]
      const tv = T[1] + g('in_none')[1] + g('out_none')[1]
      const rq = (r.eb - r.bb) - tq
      const rv = (r.ep - r.bp) - tv
      if (Math.abs(rq) > 1e-6) add('residual', rq, rv) // movements the reference books without a kind: they change the balance but sit in no column
      marks.push({ day, id: r.id, end_qty: r.eb, end_value: r.ep })
    }
  }
  return { moves, marks }
}

/** Spreads the product-level movements over warehouses so that BOTH the product totals and the reference's per-warehouse totals
 * hold for every (day, kind): iterative proportional fitting seeded with the reference's `stock=<id>` filter result. What the
 * warehouse totals contain beyond the product list (items the product report hides) goes to a hidden pseudo item. */
function allocate(productMoves, seeds, stockMarg) {
  const key = (d, k) => d + '|' + k
  const groups = new Map()
  for (const m of productMoves) { const g = groups.get(key(m.day, m.kind)) || { prods: [], seeds: [], marg: [] }; g.prods.push(m); groups.set(key(m.day, m.kind), g) }
  for (const m of seeds) { const g = groups.get(key(m.day, m.kind)); if (g) g.seeds.push(m) }
  for (const t of stockMarg) { let g = groups.get(key(t.day, t.kind)); if (!g) { g = { prods: [], seeds: [], marg: [] }; groups.set(key(t.day, t.kind), g) } g.marg.push(t) }
  const out = []
  for (const [k, g] of groups) {
    const [day, kind] = k.split('|')
    const whs = [...new Set([...g.marg.map((m) => m.warehouse), ...g.seeds.map((m) => m.warehouse)])]
    const tq = new Map(g.marg.map((m) => [m.warehouse, m.qty]))
    const tv = new Map(g.marg.map((m) => [m.warehouse, m.value]))
    const sgn = Math.sign(g.prods.reduce((a, p) => a + p.qty, 0) || [...tq.values()].reduce((a, b) => a + b, 0)) || 1
    const rowT = g.prods.map((p) => Math.abs(p.qty))
    const colT = whs.map((w) => Math.max(0, sgn * (tq.get(w) ?? 0)))
    // the part of a warehouse total the product list cannot hold goes to the hidden item
    const prodTotal = rowT.reduce((a, b) => a + b, 0)
    const colTotal = colT.reduce((a, b) => a + b, 0)
    let fit = colT.slice()
    if (prodTotal < colTotal - 1e-9) {
      // assign the surplus to the warehouses with the biggest totals not explained by the seeds
      let surplus = colTotal - prodTotal
      const room = whs.map((w, j) => Math.max(0, colT[j] - g.seeds.filter((s) => s.warehouse === w).reduce((a, s) => a + Math.abs(s.qty), 0)))
      const roomTotal = room.reduce((a, b) => a + b, 0) || 1
      fit = colT.map((v, j) => v - Math.min(v, (surplus * room[j]) / roomTotal))
      const used = fit.reduce((a, b) => a + b, 0)
      if (Math.abs(used - prodTotal) > 1e-6) fit = fit.map((v) => (used > 0 ? (v * prodTotal) / used : 0))
    } else if (prodTotal > colTotal + 1e-9 && colTotal > 0) {
      fit = fit.map((v) => (v * prodTotal) / colTotal)
    } else if (colTotal === 0) {
      fit = whs.map(() => 0)
    }
    let X = g.prods.map((p, i) => whs.map((w, j) => { const sd = Math.abs(g.seeds.filter((s) => s.id === p.id && s.warehouse === w).reduce((a, s) => a + s.qty, 0)); return sd > 1e-12 ? sd : rowT[i] > 0 && fit[j] > 0 ? 1e-6 : 0 }))
    for (let it = 0; it < 400 && g.prods.length; it++) {
      for (let i = 0; i < X.length; i++) { const sum = X[i].reduce((a, b) => a + b, 0); if (sum > 0) X[i] = X[i].map((v) => (v * rowT[i]) / sum) }
      for (let j = 0; j < whs.length; j++) { const sum = X.reduce((a, r) => a + r[j], 0); if (sum > 0) for (const r of X) r[j] = (r[j] * fit[j]) / sum }
    }
    g.prods.forEach((p, i) => whs.forEach((w, j) => { const q = X[i][j] * sgn; if (Math.abs(q) > 1e-9) out.push({ day, id: p.id, name: p.name, kind, warehouse: w, qty: q, value: p.qty ? p.value * (q / p.qty) : 0 }) }))
    whs.forEach((w, j) => {
      const placed = X.reduce((a, r) => a + r[j], 0) * sgn
      const extraQ = (tq.get(w) ?? 0) - placed
      if (Math.abs(extraQ) > 1e-6) {
        const placedV = out.filter((o) => o.day === day && o.kind === kind && o.warehouse === w).reduce((a, o) => a + o.value, 0)
        out.push({ day, id: 'hidden', name: '—', kind, warehouse: w, qty: extraQ, value: (tv.get(w) ?? 0) - placedV })
      }
    })
  }
  return out
}

const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())`)
  await c.query(`CREATE TABLE IF NOT EXISTS stock_report_ref_moves (id serial PRIMARY KEY, day text NOT NULL, warehouse text NOT NULL, item_key text NOT NULL, kind text NOT NULL, qty double precision NOT NULL, value double precision NOT NULL DEFAULT 0, doc_type text, doc_id integer, name text)`)
  await c.query(`CREATE TABLE IF NOT EXISTS stock_report_ref_marks (id serial PRIMARY KEY, day text NOT NULL, item_key text NOT NULL, end_qty double precision NOT NULL, end_value double precision NOT NULL)`)
  await c.query(`CREATE TABLE IF NOT EXISTS stock_report_ref_meta (key text PRIMARY KEY, value text NOT NULL)`)
  await c.query(`CREATE INDEX IF NOT EXISTS stock_report_ref_moves_item ON stock_report_ref_moves (item_key, day)`)
  await c.query(`CREATE INDEX IF NOT EXISTS stock_report_ref_marks_item ON stock_report_ref_marks (item_key, day)`)
  const done = (await c.query(`SELECT 1 FROM stock_report_ref_meta WHERE key = 'built'`)).rows.length
  if (done) { console.log('already built'); await c.query('ROLLBACK'); await c.end(); process.exit(0) }

  const { moves, marks } = normalize(days)
  // The reference lists raw materials as products; here they are raw_material:<id> ledger items (product_kind_overrides).
  const overrides = new Map()
  try { for (const r of (await c.query(`SELECT product_id, raw_material_id FROM product_kind_overrides WHERE kind = 'raw_material'`)).rows) overrides.set(r.product_id, r.raw_material_id) } catch { /* table absent: products only */ }
  const keyOf = (id) => (overrides.has(id) ? 'raw_material:' + overrides.get(id) : 'product:' + id)
  // Warehouse attribution. With scripts/demo/data/sbd-reference-warehouse-days.json the movements come per warehouse straight
  // from the reference (its `stock=<id>` filter); whatever the warehouses do not explain is booked to the product's busiest
  // warehouse. Without that file: match the visible reference movement rows (same product + kind, nearest day).
  const V = (await c.query('SELECT item_key, day, warehouse, qty, kind, doc_type, doc_id FROM stock_movement_reference_rows')).rows
  const busiest = new Map()
  for (const v of V) {
    const b = busiest.get(v.item_key) || new Map()
    b.set(v.warehouse, (b.get(v.warehouse) || 0) + Math.abs(v.qty))
    busiest.set(v.item_key, b)
  }
  const fallback = (id) => { const b = busiest.get('product:' + id); if (!b) return 'toshkent'; return [...b.entries()].sort((x, y) => y[1] - x[1])[0][0] }
  const dd = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 864e5)
  const vPool = new Map()
  for (const v of V) {
    const k = v.item_key + '|' + v.kind + '|' + v.warehouse
    if (!vPool.has(k)) vPool.set(k, [])
    vPool.get(k).push({ ...v, left: v.qty })
  }
  const docOf = (id, kind, warehouse, day, qty) => {
    const hit = (vPool.get('product:' + id + '|' + kind + '|' + warehouse) || []).filter((v) => Math.sign(v.left) === Math.sign(qty) && Math.abs(v.left) > 1e-9).sort((x, y) => dd(x.day, day) - dd(y.day, day))[0]
    if (!hit) return null
    hit.left -= Math.sign(qty) * Math.min(Math.abs(qty), Math.abs(hit.left))
    return hit.doc_id
  }
  const rowsOut = []
  const sorted = [...moves].sort((a, b) => (a.day < b.day ? -1 : 1))
  if (byWarehouse && stockGroups) {
    const seeds = []
    for (const [whId, perDay] of Object.entries(byWarehouse.data)) for (const m of normalize(perDay).moves) seeds.push({ ...m, warehouse: byWarehouse.names[whId] })
    const marg = []
    for (const [day, rows] of Object.entries(stockGroups)) for (const r of rows) for (const m of normalize({ [day]: [{ ...r, id: 0, bp: 0, ep: 0 }] }).moves) marg.push({ day, kind: m.kind, qty: m.qty, value: m.value, warehouse: r.name })
    const placed = allocate(sorted, seeds, marg)
    for (const a of placed) {
      const hidden = a.id === 'hidden'
      if (hidden) continue // totals the reference's product report does not contain; they would show up as a bogus product row
      rowsOut.push({ day: a.day, warehouse: a.warehouse, item_key: hidden ? 'refhidden:stock' : keyOf(a.id), kind: a.kind, qty: a.qty, value: a.value, doc_type: DOC[a.kind], doc_id: hidden ? null : docOf(a.id, a.kind, a.warehouse, a.day, a.qty), name: a.name })
    }
    console.log('allocated rows', placed.length, 'hidden', placed.filter((a) => a.id === 'hidden').length)
  } else if (byWarehouse) {
    const sums = new Map() // product|day|kind → what the warehouses explain
    const whMoves = []
    for (const [whId, perDay] of Object.entries(byWarehouse.data)) {
      const name = byWarehouse.names[whId]
      for (const m of normalize(perDay).moves) {
        whMoves.push({ ...m, warehouse: name })
        const k = m.id + '|' + m.day + '|' + m.kind
        const cur = sums.get(k) || { qty: 0, value: 0 }
        sums.set(k, { qty: cur.qty + m.qty, value: cur.value + m.value })
      }
    }
    for (const m of whMoves.sort((a, b) => (a.day < b.day ? -1 : 1))) rowsOut.push({ day: m.day, warehouse: m.warehouse, item_key: keyOf(m.id), kind: m.kind, qty: m.qty, value: m.value, doc_type: DOC[m.kind], doc_id: docOf(m.id, m.kind, m.warehouse, m.day, m.qty), name: m.name })
    let leftovers = 0
    for (const m of sorted) {
      const got = sums.get(m.id + '|' + m.day + '|' + m.kind) || { qty: 0, value: 0 }
      const dq = m.qty - got.qty
      const dv = m.value - got.value
      if (Math.abs(dq) > 1e-6 || Math.abs(dv) > 0.01) {
        leftovers++
        const wh = fallback(m.id)
        rowsOut.push({ day: m.day, warehouse: wh, item_key: keyOf(m.id), kind: m.kind, qty: dq, value: dv, doc_type: DOC[m.kind], doc_id: docOf(m.id, m.kind, wh, m.day, dq), name: m.name })
      }
    }
    console.log('warehouse-level moves', whMoves.length, 'leftover corrections', leftovers)
  } else {
    for (const m of sorted) {
      const itemKey = keyOf(m.id)
      const pool = []
      for (const [k, list] of vPool) if (k.startsWith('product:' + m.id + '|' + m.kind + '|')) pool.push(...list)
      const list = pool.filter((v) => Math.sign(v.left) === Math.sign(m.qty) && Math.abs(v.left) > 1e-9).sort((x, y) => dd(x.day, m.day) - dd(y.day, m.day))
      let need = m.qty
      for (const v of list) {
        if (Math.abs(need) < 1e-9) break
        const take = Math.sign(need) * Math.min(Math.abs(need), Math.abs(v.left))
        rowsOut.push({ day: m.day, warehouse: v.warehouse, item_key: itemKey, kind: m.kind, qty: take, value: m.value * (take / m.qty), doc_type: DOC[m.kind], doc_id: v.doc_id, name: m.name })
        v.left -= take
        need -= take
      }
      if (Math.abs(need) > 1e-9) rowsOut.push({ day: m.day, warehouse: fallback(m.id), item_key: itemKey, kind: m.kind, qty: need, value: m.value * (need / m.qty), doc_type: DOC[m.kind], doc_id: null, name: m.name })
    }
  }
  const registry = []
  for (const r of rowsOut) {
    const ins = await c.query(`INSERT INTO stock_report_ref_moves (day, warehouse, item_key, kind, qty, value, doc_type, doc_id, name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [r.day, r.warehouse, r.item_key, r.kind, r.qty, r.value, r.doc_type, r.doc_id, r.name])
    registry.push(['stock_report_ref_moves', String(ins.rows[0].id)])
  }
  for (const m of marks) {
    const ins = await c.query(`INSERT INTO stock_report_ref_marks (day, item_key, end_qty, end_value) VALUES ($1,$2,$3,$4) RETURNING id`, [m.day, keyOf(m.id), m.end_qty, m.end_value])
    registry.push(['stock_report_ref_marks', String(ins.rows[0].id)])
  }
  await c.query(`INSERT INTO stock_report_ref_meta (key, value) VALUES ('cutoff', $1), ('built', '1')`, [CUTOFF])
  registry.push(['stock_report_ref_meta', 'cutoff'], ['stock_report_ref_meta', 'built'])
  for (const [t, id] of registry) await c.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ($1,$2,'sbd-parity')`, [t, id])
  await c.query('COMMIT')
  console.log('moves', rowsOut.length, 'marks', marks.length, 'registered', registry.length)
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
