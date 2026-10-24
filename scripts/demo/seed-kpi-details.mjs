// KPI task details (domain "qa-per").
//
// The reference's "KPI задачи" row card shows each KPI's reward levels, currency, date types and the linked
// brands / price lists / products / product types / product groups (GET staff/performance_indicator/<id>/).
// Locally kpi_tasks keeps only the list columns, so the detail JSON of the 97 reference KPIs is stored in a new
// table kpi_task_details(task_id, detail).
//
// INSERT-only and idempotent: no existing row is updated or deleted; inserted rows are registered in
// demo_seed_rows (domain "qa-per") so scripts/demo/rollback-qa-per.mjs can remove exactly these rows.
//
//   node scripts/demo/seed-kpi-details.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const DOMAIN = "qa-per"
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)
  if (!match) throw new Error("DATABASE_URL is not set")
  return match[1].trim()
}

const rows = JSON.parse(fs.readFileSync(path.join(here, "data/kpi-task-details.json"), "utf8"))
const client = new pg.Client({ connectionString: databaseUrl() })
await client.connect()
try {
  await client.query("BEGIN")
  await client.query(`CREATE TABLE IF NOT EXISTS kpi_task_details (task_id INTEGER PRIMARY KEY, detail TEXT NOT NULL)`)
  await client.query(
    `CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz default now())`,
  )
  let inserted = 0
  for (const row of rows) {
    const done = await client.query(
      `INSERT INTO kpi_task_details (task_id, detail) VALUES ($1, $2) ON CONFLICT (task_id) DO NOTHING`,
      [row.id, JSON.stringify(row.detail)],
    )
    if (done.rowCount) {
      inserted += 1
      await client.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('kpi_task_details', $1, $2)`, [String(row.id), DOMAIN])
    }
  }
  await client.query("COMMIT")
  console.log({ inserted })
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
