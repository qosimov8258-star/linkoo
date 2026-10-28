// P&L "Списанные товары" must stay equal to the reference (2025: 22 233 727,50; 2026-01-01..10-24: 6 205 074,72) now that the
// write-off documents are the reference's. The two calibration rows (kind 'writeoffs') are recomputed:
//   amount = target - (Σ finished documents of the period). Old amounts are kept in demo_seed_updates (domain 'parity-wo-pnl').
// Rollback: rollback-parity-writeoffs-pnl.mjs
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const docs = JSON.parse(fs.readFileSync(new URL('./data/qa-sklad-write-offs.json', import.meta.url), 'utf8')).filter((d) => d.status === 'finished')
const raw = (from, to) => docs.filter((d) => d.created.slice(0, 10) >= from && d.created.slice(0, 10) <= to).reduce((s, d) => s + d.items.reduce((a, i) => a + Math.round(i.qty * i.price * 1e6) / 1e6, 0), 0)
const TARGETS = [
  { id: 3, from: '2025-01-01', to: '2025-12-31', target: 22233727.5 },
  { id: 4, from: '2026-01-01', to: '2026-10-24', target: 6205074.72 },
]
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_updates (table_name text, row_id text, column_name text, old_value jsonb, new_value jsonb, domain text, created_at timestamptz DEFAULT now())`)
  for (const t of TARGETS) {
    const amount = Math.round((t.target - raw(t.from, t.to)) * 1e6) / 1e6
    const cur = (await c.query(`SELECT amount FROM pnl_adjustments WHERE id = $1 AND kind = 'writeoffs'`, [t.id])).rows[0]
    if (!cur) throw new Error(`pnl_adjustments ${t.id} missing`)
    const done = (await c.query(`SELECT 1 FROM demo_seed_updates WHERE table_name='pnl_adjustments' AND row_id=$1 AND domain='parity-wo-pnl'`, [String(t.id)])).rows.length
    if (!done) {
      await c.query(`INSERT INTO demo_seed_updates (table_name,row_id,column_name,old_value,new_value,domain) VALUES ('pnl_adjustments',$1,'amount',$2,$3,'parity-wo-pnl')`, [String(t.id), JSON.stringify(cur.amount), JSON.stringify(amount)])
    }
    await c.query('UPDATE pnl_adjustments SET amount = $2 WHERE id = $1', [t.id, amount])
    console.log(t.id, 'amount', cur.amount, '->', amount)
  }
  await c.query('COMMIT')
} catch (e) {
  await c.query('ROLLBACK')
  throw e
}
await c.end()
