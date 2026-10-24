// Restores the finance demo expense/other-income entries and removes the reference-derived 'finance2' expense entries
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query(`DELETE FROM cash_management_entries WHERE id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name='cash_management_entries' AND domain='finance2')`)
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='cash_management_entries' AND domain='finance2'`)
await c.query(`INSERT INTO cash_management_entries SELECT * FROM demo_seed_backup_cash_management_entries`)
await c.query(`INSERT INTO demo_seed_rows SELECT * FROM demo_seed_backup_cash_management_entries_registry`)
await c.query(`SELECT setval(pg_get_serial_sequence('cash_management_entries','id'), (SELECT max(id) FROM cash_management_entries))`)
await c.query('COMMIT')
console.log('restored')
await c.end()
