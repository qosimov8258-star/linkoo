// Restores client_restrictions (and its demo registry rows) from the backup tables created by apply-client-restrictions.mjs
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query('DELETE FROM client_restrictions')
await c.query('INSERT INTO client_restrictions SELECT * FROM demo_seed_backup_client_restrictions')
await c.query(`DELETE FROM demo_seed_rows WHERE table_name='client_restrictions'`)
await c.query(`INSERT INTO demo_seed_rows SELECT * FROM demo_seed_backup_client_restrictions_registry`)
await c.query('COMMIT')
console.log('restored')
await c.end()
