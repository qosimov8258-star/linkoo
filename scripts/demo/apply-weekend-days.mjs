// The reference marks only Sundays as holidays (all months of 2026). Removes our 8 demo holiday rows
// (registered in demo_seed_rows, domain 'field-ops'). Backup: demo_seed_backup_attendance_weekend_days (+ _registry).
// Rollback: rollback-weekend-days.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  const reg = (await c.query(`SELECT row_id FROM demo_seed_rows WHERE table_name='attendance_weekend_days' AND domain='field-ops'`)).rows.map((r) => Number(r.row_id))
  if (reg.length) {
    if (!(await c.query(`SELECT to_regclass('demo_seed_backup_attendance_weekend_days') AS t`)).rows[0].t) {
      await c.query(`CREATE TABLE demo_seed_backup_attendance_weekend_days AS SELECT * FROM attendance_weekend_days WHERE id = ANY($1)`, [reg])
      await c.query(`CREATE TABLE demo_seed_backup_attendance_weekend_days_registry AS SELECT * FROM demo_seed_rows WHERE table_name='attendance_weekend_days'`)
    }
    const del = await c.query('DELETE FROM attendance_weekend_days WHERE id = ANY($1)', [reg])
    await c.query(`DELETE FROM demo_seed_rows WHERE table_name='attendance_weekend_days'`)
    console.log('removed', del.rowCount)
  } else console.log('nothing to do')
  await c.query('COMMIT')
} catch (e) { await c.query('ROLLBACK'); throw e }
await c.end()
