// "Оплаты от клиентов": insert the reference's 367 client_transaction rows (type 1) into customer_payments.
// Insert-only; rows are registered in demo_seed_rows (domain 'parity'). Idempotent.
// The old sample rows are hidden by a separate step: apply-parity-payments-hide-old.mjs
// Rollback: rollback-parity-payments.mjs
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const rows = JSON.parse(fs.readFileSync(new URL('./data/parity-client-transactions.json', import.meta.url), 'utf8'))
const c = new pg.Client({ connectionString: url })
await c.connect()

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const ruDate = (iso) => {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]}` : ''
}
const person = (u) => (u ? `${u.first_name ?? ''} ${u.second_name ?? ''}`.trim() : '')

await c.query('BEGIN')
try {
  const already = (await c.query(`SELECT count(*)::int n FROM demo_seed_rows WHERE table_name='customer_payments' AND domain='parity'`)).rows[0].n
  if (already > 0) {
    console.log('already applied', already)
    await c.query('ROLLBACK')
    await c.end()
    process.exit(0)
  }
  const clientIds = new Set((await c.query('SELECT id FROM clients')).rows.map((r) => r.id))
  const orderIds = new Set((await c.query('SELECT id FROM orders')).rows.map((r) => r.id))
  const cashboxes = new Map((await c.query('SELECT id, name FROM cashboxes')).rows.map((r) => [r.id, r]))
  let n = 0
  for (const t of rows) {
    const cb = t.cashbox ? cashboxes.get(t.cashbox.id) : null
    const isBank = t.payment_type === 'bank'
    const accepted = cb && t.accepted_time ? 1 : 0
    const real = Number(t.real_amount ?? t.amount)
    const created = String(t.created_date).slice(0, 19)
    const cols = {
      client: t.client?.name ?? '',
      client_id: t.client && clientIds.has(t.client.id) ? t.client.id : null,
      created_by: person(t.user),
      paid_at: ruDate(created),
      payment_date: created,
      accepted_at: accepted ? ruDate(String(t.accepted_time)) : '',
      accepted_by: accepted ? person(t.accepted_by) : '',
      accepted,
      agent: person(t.market?.responsible_agent),
      organization: '',
      amount: Number(t.amount),
      currency: t.currency?.name ?? 'SUM',
      amount_sum_equivalent: Number(t.internal),
      real_amount: real,
      real_currency: t.real_currency?.name ?? t.currency?.name ?? 'SUM',
      cash_amount: cb && !isBank ? real : 0,
      kassa: cb?.name ?? '',
      cashbox_id: cb ? cb.id : null,
      comment: t.comment || 'Не указано',
      icon: isBank ? 'card' : 'cash',
      branch: '',
      delivery_man: person(t.delivery_man),
      income_category: '',
      order_id: t.order && orderIds.has(t.order) ? t.order : null,
      custom_rate: t.custom_rate != null ? Number(t.custom_rate) : null,
      rate_type: t.rate_type ?? '',
      client_confirmation: t.client_confirmation ?? '',
      created_at: created.replace('T', ' '),
      updated_at: created.replace('T', ' '),
      doc_no: t.id,
      is_deleted: 0,
      deleted_at: '',
    }
    const names = Object.keys(cols)
    const res = await c.query(
      `INSERT INTO customer_payments (${names.join(',')}) VALUES (${names.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`,
      names.map((k) => cols[k]),
    )
    await c.query(`INSERT INTO demo_seed_rows (table_name,row_id,domain) VALUES ('customer_payments',$1,'parity')`, [String(res.rows[0].id)])
    n++
  }
  await c.query('COMMIT')
  console.log('inserted', n)
} catch (e) {
  await c.query('ROLLBACK')
  throw e
}
console.log((await c.query('SELECT count(*) FILTER (WHERE is_deleted=0)::int live, count(*)::int total FROM customer_payments')).rows)
await c.end()
