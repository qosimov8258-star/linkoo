// Removes only the rows registered by seed-branch-kpi-reference.mjs (domain "kpi-ref").
//   node scripts/demo/rollback-branch-kpi-reference.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? match?.[1].trim() })
await client.connect()
try {
  await client.query("BEGIN")
  const rows = (await client.query(`SELECT table_name, row_id FROM demo_seed_rows WHERE domain = 'kpi-ref'`)).rows
  for (const row of rows) {
    if (["branch_kpi_plans", "branch_kpi_balances", "branch_kpi_recalcs"].includes(row.table_name)) await client.query(`DELETE FROM ${row.table_name} WHERE id = $1`, [Number(row.row_id)])
  }
  await client.query(`DELETE FROM demo_seed_rows WHERE domain = 'kpi-ref'`)
  await client.query("COMMIT")
  console.log({ removed: rows.length })
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
