// Refreshes the reference copy of the cash transactions to its CURRENT state (2026-10-26: the two unverified rows 630/631 are
// gone from the reference and a new transfer №632 appeared) and makes the cashbox ledger read it (lib/finance/sources.ts).
// 1) re-imports data/cash-reference-rows.json through apply-final-cash-list.mjs (idempotent upserts),
// 2) removes the stale copies 630/631 after backing them up into demo_seed_backup_cash_reference_rows.
// Rollback: rollback-cash-report-refresh.mjs
import pg from 'pg'
import fs from 'fs'
import { execFileSync } from 'node:child_process'
execFileSync(process.execPath, [new URL('./apply-final-cash-list.mjs', import.meta.url).pathname], { stdio: 'inherit' })
const url = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').match(/DATABASE_URL=(.*)/)[1].trim()
const keep = new Set(JSON.parse(fs.readFileSync(new URL('./data/cash-reference-rows.json', import.meta.url), 'utf8')).map((r) => r.id))
const c = new pg.Client({ connectionString: url })
await c.connect()
await c.query('BEGIN')
try {
  await c.query('CREATE TABLE IF NOT EXISTS demo_seed_backup_cash_reference_rows AS TABLE cash_reference_rows WITH NO DATA')
  const stale = (await c.query('SELECT id FROM cash_reference_rows')).rows.map((r) => r.id).filter((id) => !keep.has(id))
  if (stale.length) {
    await c.query('INSERT INTO demo_seed_backup_cash_reference_rows SELECT * FROM cash_reference_rows WHERE id = ANY($1) AND id NOT IN (SELECT id FROM demo_seed_backup_cash_reference_rows)', [stale])
    await c.query('DELETE FROM cash_reference_rows WHERE id = ANY($1)', [stale])
    await c.query(`DELETE FROM demo_seed_rows WHERE table_name = 'cash_reference_rows' AND row_id = ANY($1)`, [stale.map(String)])
  }
  await c.query('COMMIT')
  console.log('stale removed', stale)
} catch (e) { await c.query('ROLLBACK'); throw e }
console.log((await c.query('SELECT count(*)::int n, sum(verified)::int v FROM cash_reference_rows')).rows)
await c.end()
