// Restores write_offs ids 1-17 from demo_seed_backup_write_offs (made by apply-parity-writeoffs.mjs)
import pg from 'pg'
import fs from 'fs'

const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
await c.query('DELETE FROM write_offs WHERE id <= 17')
await c.query('INSERT INTO write_offs SELECT * FROM demo_seed_backup_write_offs')
await c.query('COMMIT')
console.log('restored')
await c.end()
