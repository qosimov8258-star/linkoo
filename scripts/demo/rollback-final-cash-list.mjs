// Removes what apply-final-cash-list.mjs added (the list then shows the real tables again, as before)
import pg from 'pg'
import fs from 'fs'
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
const a = await c.query(`DELETE FROM cash_reference_rows WHERE id::text IN (SELECT row_id FROM demo_seed_rows WHERE table_name = 'cash_reference_rows' AND domain = 'finalcash')`)
const b = await c.query(`DELETE FROM cash_list_cutoff WHERE src IN (SELECT row_id FROM demo_seed_rows WHERE table_name = 'cash_list_cutoff' AND domain = 'finalcash')`)
await c.query(`DELETE FROM demo_seed_rows WHERE domain = 'finalcash'`)
await c.query('COMMIT')
console.log('removed', a.rowCount, 'reference rows,', b.rowCount, 'cutoffs')
await c.end()
