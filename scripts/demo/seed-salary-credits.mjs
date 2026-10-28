// "Зачислить" transactions of "Зарплата и установка планов": the reference writes, for every approved record, an employee-balance
// transaction "Зарплата" (type monthly) and "КПИ" (performance_bonus) dated with the last day of the month. This inserts the real ones of the
// reference (staff/salary_balance/act of the six employees that have them, data/salary-credits-reference.json) into salary_credits, which the
// finance ledger ("Баланс сотрудников", reports) reads instead of the old invented salary_plans.
//
// INSERT-only and idempotent (a transaction already present for the same user / date / type / amount is skipped). Inserted rows are registered
// in demo_seed_rows (domain "qa-salary-credits"); scripts/demo/rollback-salary-credits.mjs removes exactly these rows.
//
//   node scripts/demo/seed-salary-credits.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const DOMAIN = "qa-salary-credits"
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../..")
const url = process.env.DATABASE_URL ?? fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")

const credits = JSON.parse(fs.readFileSync(path.join(here, "data/salary-credits-reference.json"), "utf8"))
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query("BEGIN")
  await client.query(`CREATE TABLE IF NOT EXISTS salary_credits (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL, type TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'SUM', amount DOUBLE PRECISION NOT NULL DEFAULT 0, created_date TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '')`)
  await client.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz default now())`)
  let inserted = 0
  for (const item of credits) {
    const [year, month] = item.createdDate.slice(0, 7).split("-").map(Number)
    const exists = await client.query(
      `SELECT 1 FROM salary_credits WHERE user_id = $1 AND created_date = $2 AND type = $3 AND amount = $4 AND currency = $5`,
      [item.userId, item.createdDate, item.type, item.amount, item.currency],
    )
    if (exists.rowCount) continue
    const done = await client.query(
      `INSERT INTO salary_credits (user_id, month, year, type, currency, amount, created_date, comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [item.userId, month, year, item.type, item.currency, item.amount, item.createdDate, item.comment],
    )
    inserted += 1
    await client.query(`INSERT INTO demo_seed_rows (table_name, row_id, domain) VALUES ('salary_credits', $1, $2)`, [String(done.rows[0].id), DOMAIN])
  }
  await client.query("COMMIT")
  console.log({ inserted })
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
