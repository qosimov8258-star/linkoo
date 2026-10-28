// After the reference write-off documents replaced our demo ones (apply-parity-writeoffs.mjs) three product/warehouse
// pairs would go negative. Insert-only: one accepted compensation receipt per warehouse (1 сент. 2024, registered in
// demo_seed_rows, domain 'parity-wo'; hidden from the receipts list like the other demo receipts). Idempotent.
// Rollback: rollback-parity-writeoffs-stock.mjs
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const NEEDED = [
  { warehouse: 'Andijon skladi', product: 'gorilla 2 litr', qty: 240 },
  { warehouse: 'ANGOR', product: 'robot moshina', qty: 15 },
  { warehouse: 'Jizzax ombori', product: 'shokolod', qty: 30 },
]
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  const done = (await c.query(`SELECT count(*)::int n FROM demo_seed_rows WHERE table_name='supplier_incomings' AND domain='parity-wo'`)).rows[0].n
  if (done > 0) {
    console.log('already applied', done)
    await c.query('ROLLBACK')
    await c.end()
    process.exit(0)
  }
  for (const need of NEEDED) {
    const cost = 1000
    const items = [{ id: 1, product: need.product, expiry: '', qty: need.qty, block: 0, kg: 0, netWeight: 0, cost, total: need.qty * cost }]
    const amount = need.qty * cost
    const row = {
      supplier: 'Поставщик', warehouse: need.warehouse, date: '1 сент. 2024', payment_type: 'Банковский счет', contract_number: '', amount, status: 'принят',
      invoice_number: '', organization: '', branch: '', phone: 'Не указан', email: 'Не указан', initiator: 'Admin Ritm', paid: amount, time: '', comment: '',
      items: JSON.stringify(items), created_at: '2024-09-01 09:45:00', updated_at: '2024-09-01 09:45:00',
    }
    const columns = Object.keys(row)
    const res = await c.query(`INSERT INTO supplier_incomings (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, columns.map((k) => row[k]))
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('supplier_incomings',$1,'parity-wo')`, [String(res.rows[0].id)])
  }
  await c.query('COMMIT')
  console.log('inserted', NEEDED.length)
} catch (e) {
  await c.query('ROLLBACK')
  throw e
}
await c.end()
