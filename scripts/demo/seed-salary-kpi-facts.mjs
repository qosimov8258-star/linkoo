// "Зарплата и установка планов" > "Скачать EXCEL": the KPI statistics (Продажа / Возврат / Факт / % / Уровень / Сумма бонуса, work days) that the
// reference's own export (staff/staff_balance/stat_excel) returned for every month, read from its downloaded sheets (data/salary-kpi-facts.json).
//
// INSERT-only and idempotent (ON CONFLICT DO NOTHING). Inserted rows are registered in demo_seed_rows (domain "qa-salary-kpi") so
// scripts/demo/rollback-salary-kpi-facts.mjs can remove exactly these rows.
//
//   node scripts/demo/seed-salary-kpi-facts.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const DOMAIN = "qa-salary-kpi"
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")
const url = process.env.DATABASE_URL ?? fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")

const months = JSON.parse(fs.readFileSync(path.join(here, "data/salary-kpi-facts.json"), "utf8"))
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query("BEGIN")
  await client.query(`CREATE TABLE IF NOT EXISTS salary_kpi_columns (month INTEGER NOT NULL, year INTEGER NOT NULL, pos INTEGER NOT NULL, name TEXT NOT NULL, PRIMARY KEY (month, year, pos))`)
  await client.query(`CREATE TABLE IF NOT EXISTS salary_kpi_rows (user_id INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL, work_days INTEGER, worked_days INTEGER, PRIMARY KEY (user_id, month, year))`)
  await client.query(`CREATE TABLE IF NOT EXISTS salary_kpi_facts (
    user_id INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL, kpi_name TEXT NOT NULL,
    plan DOUBLE PRECISION, sale DOUBLE PRECISION, returns DOUBLE PRECISION, fact DOUBLE PRECISION, percent DOUBLE PRECISION, level DOUBLE PRECISION, bonus DOUBLE PRECISION,
    PRIMARY KEY (user_id, month, year, kpi_name))`)
  await client.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz default now())`)
  const count = { columns: 0, rows: 0, facts: 0 }
  const register = (table, id) => client.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ($1, $2, $3)`, [table, id, DOMAIN])
  for (const item of months) {
    for (const [pos, name] of item.columns.entries()) {
      const done = await client.query(`INSERT INTO salary_kpi_columns (month, year, pos, name) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING pos`, [item.month, item.year, pos, name])
      if (done.rowCount) { count.columns += 1; await register("salary_kpi_columns", `${item.year}-${item.month}-${pos}`) }
    }
    for (const row of item.rows) {
      const done = await client.query(
        `INSERT INTO salary_kpi_rows (user_id, month, year, work_days, worked_days) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING user_id`,
        [row.userId, item.month, item.year, row.workDays, row.workedDays],
      )
      if (done.rowCount) { count.rows += 1; await register("salary_kpi_rows", `${row.userId}-${item.year}-${item.month}`) }
      for (const [kpi, v] of Object.entries(row.facts)) {
        const fact = await client.query(
          `INSERT INTO salary_kpi_facts (user_id, month, year, kpi_name, plan, sale, returns, fact, percent, level, bonus) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING user_id`,
          [row.userId, item.month, item.year, kpi, ...v],
        )
        if (fact.rowCount) { count.facts += 1; await register("salary_kpi_facts", `${row.userId}|${item.year}|${item.month}|${kpi}`) }
      }
    }
  }
  await client.query("COMMIT")
  console.log(count)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
