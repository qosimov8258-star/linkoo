// Removes exactly the rows inserted by scripts/demo/seed-finance.mjs (the ones listed in demo_seed_rows for
// domain 'finance'). Tables the seed created (customer_returns, demo_seed_rows) are left in place.
// Usage: node scripts/demo/rollback-finance.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const envText = fs.readFileSync(path.join(root, ".env"), "utf8")
const url = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")

const ALLOWED = new Set([
  "cash_management_entries", "cash_transfers", "cash_acceptances", "supplier_payments", "cost_of_goods_rows",
  "customer_returns", "write_offs", "inventory_records", "salary_plans", "cashback_withdrawal_requests",
  "debt_limits", "income_categories",
])

const client = new pg.Client({ connectionString: url })
await client.connect()
await client.query("BEGIN")
try {
  const rows = (await client.query("SELECT table_name, row_id FROM demo_seed_rows WHERE domain = 'finance' AND table_name <> '_marker'")).rows
  const byTable = new Map()
  for (const row of rows) byTable.set(row.table_name, [...(byTable.get(row.table_name) ?? []), Number(row.row_id)])
  for (const [table, ids] of byTable) {
    if (!ALLOWED.has(table)) throw new Error(`unexpected table in demo_seed_rows: ${table}`)
    const result = await client.query(`DELETE FROM ${table} WHERE id = ANY($1::int[])`, [ids])
    console.log(`${table}: removed ${result.rowCount}`)
  }
  await client.query("DELETE FROM demo_seed_rows WHERE domain = 'finance'")
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
