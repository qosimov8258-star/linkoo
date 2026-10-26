// Restores the stale reference rows 630/631 and removes row 632 (cash_reference_rows copy only)
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query('DELETE FROM cash_reference_rows WHERE id = 632')
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='cash_reference_rows' AND row_id='632'`)
await c.query('INSERT INTO cash_reference_rows SELECT * FROM demo_seed_backup_cash_reference_rows ON CONFLICT (id) DO NOTHING')
await c.query('COMMIT')
console.log('restored')
await c.end()
