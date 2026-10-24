// "Списание": local ids 1-17 were our own demo documents; the reference has real ones under the same ids.
// The rows are backed up (demo_seed_backup_write_offs) and rewritten with the reference documents
// (data/qa-sklad-write-offs.json: header + lines read from the reference API). Idempotent.
// Rollback: rollback-parity-writeoffs.mjs
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const docs = JSON.parse(fs.readFileSync(new URL('./data/qa-sklad-write-offs.json', import.meta.url), 'utf8')).filter((d) => d.id <= 17)
const c = new pg.Client({ connectionString: url })
await c.connect()
const sqlTime = (iso) => String(iso).replace('T', ' ').slice(0, 19)
await c.query('BEGIN')
try {
  const has = (await c.query(`SELECT to_regclass('demo_seed_backup_write_offs') AS t`)).rows[0].t
  if (has) {
    console.log('already applied')
    await c.query('ROLLBACK')
    await c.end()
    process.exit(0)
  }
  await c.query(`CREATE TABLE demo_seed_backup_write_offs AS SELECT * FROM write_offs WHERE id <= 17`)
  let n = 0
  for (const doc of docs) {
    const finished = doc.status === 'finished'
    const items = doc.items.map((item, index) => ({
      id: index + 1, key: `name:${item.product}`, product: item.product, code: item.code, unit: '', series: item.series, block: 0,
      qty: item.qty, cost: item.price, sum: Math.round(item.qty * item.price * 1e6) / 1e6,
    }))
    const stamp = sqlTime(doc.created)
    const res = await c.query(
      `UPDATE write_offs SET creator=$2, warehouse=$3, date=$4, status=$5, comment=$6, reason='', items=$7, created_at=$8, updated_at=$8,
         finished_at=$9, finished_by=$10, cancelled_at=$11, cancelled_by=$12 WHERE id=$1`,
      [doc.id, doc.creator, doc.warehouse, doc.created, finished ? 'закрыт' : 'отменен', doc.comment, JSON.stringify(items), stamp,
        finished ? stamp : '', finished ? doc.creator : '', finished ? '' : stamp, finished ? '' : doc.creator],
    )
    n += res.rowCount
  }
  await c.query('COMMIT')
  console.log('rewritten', n)
} catch (e) {
  await c.query('ROLLBACK')
  throw e
}
await c.end()
