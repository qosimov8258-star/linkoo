// Restores the demo holiday rows removed by apply-weekend-days.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query('INSERT INTO attendance_weekend_days SELECT * FROM demo_seed_backup_attendance_weekend_days ON CONFLICT DO NOTHING')
await c.query('INSERT INTO demo_seed_rows SELECT * FROM demo_seed_backup_attendance_weekend_days_registry')
await c.query('COMMIT')
console.log('restored')
await c.end()
