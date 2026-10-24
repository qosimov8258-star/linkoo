// "Себестоимость": the reference list has 1187 records (stock/net_cost/) while our ledger-derived list had 1836 demo-made ones.
// Insert-only, additive: the reference records go to net_cost_reference_rows (same columns as net_cost_records) and the
// reference header to net_cost_reference_totals; lib/net-cost-repo.ts lists from them when they exist.
// Nothing in net_cost_records / the stock ledger / P&L is touched. Rollback: rollback-parity-netcost.mjs
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(fs.readFileSync(new URL('./data/parity-net-cost.json', import.meta.url), 'utf8'))
const totals = JSON.parse(fs.readFileSync(new URL('./data/parity-net-cost-total.json', import.meta.url), 'utf8'))
const rawIds = new Set(JSON.parse(fs.readFileSync(new URL('./data/parity-ref-raw-products.json', import.meta.url), 'utf8')).map((p) => p.id))
const c = new pg.Client({ connectionString: url })
await c.connect()

const finKey = (v) => String(v ?? '').replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
await c.query('BEGIN')
try {
  const exists = (await c.query(`SELECT to_regclass('net_cost_reference_rows') AS t`)).rows[0].t
  if (exists) {
    console.log('already applied')
    await c.query('ROLLBACK')
    await c.end()
    process.exit(0)
  }
  await c.query(`CREATE TABLE net_cost_reference_rows (
      id INTEGER PRIMARY KEY, nk TEXT NOT NULL UNIQUE, item_key TEXT NOT NULL, item_label TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT '', scope_name TEXT NOT NULL DEFAULT '', place TEXT NOT NULL DEFAULT '',
      day TEXT NOT NULL, at TEXT NOT NULL DEFAULT '', seq INTEGER NOT NULL DEFAULT 0, source_type TEXT NOT NULL, source_id INTEGER NOT NULL,
      entry_id INTEGER, qty DOUBLE PRECISION NOT NULL DEFAULT 0, real_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      cost DOUBLE PRECISION NOT NULL DEFAULT 0, prev_cost DOUBLE PRECISION, balance DOUBLE PRECISION NOT NULL DEFAULT 0,
      balance_after DOUBLE PRECISION NOT NULL DEFAULT 0, revaluation DOUBLE PRECISION, total_revaluation DOUBLE PRECISION,
      balance_ok INTEGER NOT NULL DEFAULT 1, negative_ok INTEGER NOT NULL DEFAULT 1, timelapse_ok INTEGER NOT NULL DEFAULT 1,
      is_current INTEGER NOT NULL DEFAULT 0, next_day TEXT, negatives TEXT NOT NULL DEFAULT '[]', sig TEXT NOT NULL DEFAULT '',
      last_check_time TEXT NOT NULL DEFAULT '')`)
  await c.query(`CREATE INDEX net_cost_reference_rows_item_idx ON net_cost_reference_rows (item_key, scope, seq)`)
  await c.query(`CREATE INDEX net_cost_reference_rows_day_idx ON net_cost_reference_rows (day, at)`)
  await c.query(`CREATE TABLE net_cost_reference_totals (id INTEGER PRIMARY KEY, totals TEXT NOT NULL DEFAULT '[]')`)

  const rawByName = new Map((await c.query('SELECT id, name FROM raw_materials')).rows.map((r) => [finKey(r.name), r.id]))
  const productIds = new Set((await c.query('SELECT id FROM products')).rows.map((r) => r.id))
  let seq = 0
  for (const r of rows.slice().sort((a, b) => String(a.created_date).localeCompare(String(b.created_date)) || a.id - b.id)) {
    seq++
    const name = r.product?.name ?? ''
    const isRaw = rawIds.has(r.product?.id)
    const itemKey = isRaw ? (rawByName.has(finKey(name)) ? `raw_material:${rawByName.get(finKey(name))}` : `name:${finKey(name)}`) : productIds.has(r.product?.id) ? `product:${r.product.id}` : `name:${finKey(name)}`
    const flags = Object.fromEntries((r.check_data ?? []).map((x) => [x.key, x.is_correct ? 1 : 0]))
    const stockName = r.stock?.name ?? ''
    const num = (v) => (v === null || v === undefined ? null : Number(v))
    const created = String(r.created_date).slice(0, 19)
    const revaluation = num(r.revaluation)
    const cost = Number(r.cost)
    await c.query(
      `INSERT INTO net_cost_reference_rows (id,nk,item_key,item_label,scope,scope_name,place,day,at,seq,source_type,source_id,entry_id,qty,real_cost,cost,prev_cost,balance,balance_after,revaluation,total_revaluation,balance_ok,negative_ok,timelapse_ok,last_check_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,0,$13,$14,$15,$16,$16,$17,$18,$19,$20,$21,$22)`,
      [
        r.id, `ref:${r.id}`, itemKey, name, stockName ? finKey(stockName) : '', stockName, stockName, created.slice(0, 10), created, seq,
        r.supply_id ? 'supplier_incomings' : r.inventory_id ? 'stock_inventories' : 'manual', r.supply_id ?? r.inventory_id ?? 0,
        Number(r.real_cost), cost, revaluation === null ? null : cost - revaluation, Number(r.balance), revaluation, num(r.total_revaluation),
        flags.is_balance_correct ?? 1, flags.is_negative_balance_correct ?? 1, flags.is_timelapse_correct ?? 1,
        r.last_check_time ? String(r.last_check_time).slice(0, 19) : '',
      ],
    )
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('net_cost_reference_rows',$1,'parity')`, [String(r.id)])
  }
  const header = totals.map((t) => ({
    stock: t.stock ? t.stock.name : null,
    cumulativeCost: Number(t.cumulative_cost),
    lastCost: Number(t.last_cost),
    fault: Number(t.fault),
    totalRevaluation: 0,
    isCorrect: !!t.is_correct,
    noCostProductCount: Number(t.no_cost_product_count ?? 0),
    lastCheckTime: t.last_check_time ? String(t.last_check_time).slice(0, 19) : '',
  }))
  await c.query(`INSERT INTO net_cost_reference_totals (id, totals) VALUES (1, $1)`, [JSON.stringify(header)])
  await c.query('COMMIT')
  console.log('inserted', rows.length, 'totals', header.length)
} catch (e) {
  await c.query('ROLLBACK')
  throw e
}
await c.end()
