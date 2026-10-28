// Removes exactly the rows inserted by scripts/demo/seed-salary-kpi-facts.mjs (demo_seed_rows, domain "qa-salary-kpi").
//   node scripts/demo/rollback-salary-kpi-facts.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const url = process.env.DATABASE_URL ?? fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query("BEGIN")
  const ids = (table) => `SELECT row_id FROM demo_seed_rows WHERE domain = 'qa-salary-kpi' AND table_name = '${table}'`
  const columns = await client.query(`DELETE FROM salary_kpi_columns WHERE (year || '-' || month || '-' || pos) IN (${ids("salary_kpi_columns")})`)
  const rows = await client.query(`DELETE FROM salary_kpi_rows WHERE (user_id || '-' || year || '-' || month) IN (${ids("salary_kpi_rows")})`)
  const facts = await client.query(`DELETE FROM salary_kpi_facts WHERE (user_id || '|' || year || '|' || month || '|' || kpi_name) IN (${ids("salary_kpi_facts")})`)
  await client.query(`DELETE FROM demo_seed_rows WHERE domain = 'qa-salary-kpi'`)
  await client.query("COMMIT")
  console.log({ columns: columns.rowCount, rows: rows.rowCount, facts: facts.rowCount })
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
