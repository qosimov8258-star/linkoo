// KPI task validity dates (domain "qa-per").
//
// The reference's "KPI задачи" tabs treat a KPI whose till_date has passed as "Не активный" even when its
// is_active flag is on (80 active / 17 inactive vs the flag's 81 / 16). Locally kpi_tasks has no date columns,
// so the dates read from the reference list API live in a new table kpi_task_dates(task_id, start_date, till_date).
//
// INSERT-only and idempotent: no existing row is updated or deleted; inserted rows are registered in
// demo_seed_rows (domain "qa-per") so scripts/demo/rollback-qa-per.mjs can remove exactly these rows.
//
//   node scripts/demo/seed-kpi-dates.mjs
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

const rows = JSON.parse(fs.readFileSync(path.join(here, "data/kpi-task-dates.json"), "utf8"))
const client = new pg.Client({ connectionString: databaseUrl() })
await client.connect()
try {
  await client.query("BEGIN")
  await client.query(`CREATE TABLE IF NOT EXISTS kpi_task_dates (task_id INTEGER PRIMARY KEY, start_date TEXT, till_date TEXT)`)
  await client.query(
    `CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz default now())`,
  )
  let inserted = 0
  for (const row of rows) {
    const done = await client.query(
      `INSERT INTO kpi_task_dates (task_id, start_date, till_date) VALUES ($1, $2, $3) ON CONFLICT (task_id) DO NOTHING`,
      [row.id, row.start, row.till],
    )
    if (done.rowCount) {
      inserted += 1
      await client.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('kpi_task_dates', $1, $2)`, [String(row.id), DOMAIN])
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
