// "Зарплата и установка планов" (/analytics/salary-planning): the reference's staff/salary records (employee x month, fixed
// salary, KPI plans, totals per currency, approved flag) plus the "ДАННЫЕ ЗА" stamps (staff_balance/last_date) of every month.
//
// INSERT-only and idempotent (ON CONFLICT DO NOTHING on (user_id, month, year) / (month, year)): no existing row is updated or
// deleted. Inserted rows are registered in demo_seed_rows (domain "qa-salary") so scripts/demo/rollback-salary-reference.mjs can
// remove exactly these rows.
//
//   node scripts/demo/seed-salary-reference.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const DOMAIN = "qa-salary"
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const match = fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)
  if (!match) throw new Error("DATABASE_URL is not set")
  return match[1].trim()
}

const data = JSON.parse(fs.readFileSync(path.join(here, "data/salary-reference.json"), "utf8"))
const client = new pg.Client({ connectionString: databaseUrl() })
await client.connect()
try {
  await client.query("BEGIN")
  await client.query(`CREATE TABLE IF NOT EXISTS salary_records (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, first_name TEXT NOT NULL DEFAULT '', second_name TEXT NOT NULL DEFAULT '',
    position TEXT NOT NULL DEFAULT '', phone TEXT, month INTEGER NOT NULL, year INTEGER NOT NULL,
    salary DOUBLE PRECISION NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'SUM', currencies TEXT NOT NULL DEFAULT '[]',
    total_bonus DOUBLE PRECISION NOT NULL DEFAULT 0, total_salary DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_approved INTEGER NOT NULL DEFAULT 0, indicators TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    UNIQUE (user_id, month, year))`)
  await client.query(`CREATE TABLE IF NOT EXISTS salary_last_dates (month INTEGER NOT NULL, year INTEGER NOT NULL, last_date TEXT, PRIMARY KEY (month, year))`)
  await client.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz default now())`)
  let records = 0
  for (const row of data.rows) {
    const done = await client.query(
      `INSERT INTO salary_records (user_id, first_name, second_name, position, phone, month, year, salary, currency, currencies, total_bonus, total_salary, is_approved, indicators)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (user_id, month, year) DO NOTHING RETURNING id`,
      [row.userId, row.firstName, row.secondName, row.position, row.phone, row.month, row.year, row.salary, row.currency, JSON.stringify(row.currencies), row.totalBonus, row.totalSalary, row.isApproved ? 1 : 0, JSON.stringify(row.indicators)],
    )
    if (done.rowCount) {
      records += 1
      await client.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('salary_records', $1, $2)`, [String(done.rows[0].id), DOMAIN])
    }
  }
  let dates = 0
  for (const item of data.lastDates) {
    const done = await client.query(`INSERT INTO salary_last_dates (month, year, last_date) VALUES ($1,$2,$3) ON CONFLICT (month, year) DO NOTHING`, [item.month, item.year, item.lastDate])
    if (done.rowCount) {
      dates += 1
      await client.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('salary_last_dates', $1, $2)`, [`${item.year}-${item.month}`, DOMAIN])
    }
  }
  await client.query("COMMIT")
  console.log({ records, dates })
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
