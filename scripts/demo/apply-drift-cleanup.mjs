// Removes leftovers that make list counts drift from the reference: QA2 price list 162, its cancelled repricing 90 (both made by
// earlier QA runs, no delete endpoint existed) and the unused demo income category 24 "Прочие приходы". Rows are backed up first
// (demo_seed_backup_drift_<table>); rollback-drift-cleanup.mjs restores them.
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
const TARGETS = [
  ['price_lists', 162, "name = 'QA2 pricelist'"],
  ['repricings', 90, "status = 'отменен' AND created_by = 'admin' AND created_at >= '2026-10-24'"],
  ['income_categories', 24, "name = 'Прочие приходы'"],
]
await c.query('BEGIN')
try {
  for (const [table, id, guard] of TARGETS) {
    const row = (await c.query(`SELECT 1 FROM ${table} WHERE id = $1 AND ${guard}`, [id])).rows.length
    if (!row) { console.log('skip', table, id); continue }
    await c.query(`CREATE TABLE IF NOT EXISTS demo_seed_backup_drift_${table} AS TABLE ${table} WITH NO DATA`)
    await c.query(`INSERT INTO demo_seed_backup_drift_${table} SELECT * FROM ${table} WHERE id = $1`, [id])
    await c.query(`DELETE FROM ${table} WHERE id = $1 AND ${guard}`, [id])
    await c.query(`DELETE FROM demo_seed_rows WHERE table_name = $1 AND row_id = $2`, [table, String(id)])
    console.log('removed', table, id)
  }
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
