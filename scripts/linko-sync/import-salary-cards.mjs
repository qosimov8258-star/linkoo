// «Зарплата и установка планов» row cards: the KPI balances Linko stored for each salary record at its «Перерасчет KPI»
// (staff/salary/<id>/ → balances: level, plan, sales, returns, fact, forecast, daily plan, bonus per KPI), from the raw
// file salary_cards.json ({<linko salary id>: card}, captured read-only from Linko's own card pages). They go to
// salary_kpi_balances (lib/salary-records-repo.ts), one row per employee, month, KPI and reached level (Linko keeps a
// row per level of a multi-level KPI and the card lists each); a re-run replaces a record's
// rows with the newer copy. Records that have no local salary_records row are reported, nothing else is touched.
//
//   node scripts/linko-sync/import-salary-cards.mjs
import fs from "node:fs"

import { capturedOrSkip, connect, ensureRegistry, register, runId } from "./lib.mjs"

const run = runId("salary-cards")
const NAME = "salary_cards"

// <RAW>/salary_cards.json (skipped when RAW lacks it), else the newest backups/linko-raw/<date> that has it.
const file = capturedOrSkip(`${NAME}.json`)
if (!file || !fs.existsSync(file)) {
  console.log("salary cards: no raw salary_cards.json")
  process.exit(0)
}
const cards = Object.values(JSON.parse(fs.readFileSync(file, "utf8")).data ?? {})

const num = (value) => (value == null || value === "" ? null : Number(value))

const client = await connect()
await ensureRegistry(client)
// Same table as the app's schema bootstrap (lib/salary-records-repo.ts), for a database the app has not opened yet.
await client.query(`CREATE TABLE IF NOT EXISTS salary_kpi_balances (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL,
  kpi_id INTEGER NOT NULL, kpi_name TEXT NOT NULL DEFAULT '', plan_type TEXT NOT NULL DEFAULT '',
  level INTEGER, level_from DOUBLE PRECISION, level_to DOUBLE PRECISION, calculation_type TEXT NOT NULL DEFAULT '',
  plan DOUBLE PRECISION NOT NULL DEFAULT 0, sales DOUBLE PRECISION, returns DOUBLE PRECISION, fact DOUBLE PRECISION,
  bonus DOUBLE PRECISION NOT NULL DEFAULT 0, forecast DOUBLE PRECISION, daily_plan DOUBLE PRECISION, daily_sales DOUBLE PRECISION,
  daily_returns DOUBLE PRECISION, daily_fact DOUBLE PRECISION, last_date TEXT, linko_id INTEGER,
  UNIQUE (user_id, month, year, kpi_id, level))`)

const COLUMNS = ["kpi_name", "plan_type", "level", "level_from", "level_to", "calculation_type", "plan", "sales", "returns", "fact", "bonus", "forecast", "daily_plan", "daily_sales", "daily_returns", "daily_fact", "last_date", "linko_id"]
let inserted = 0
let updated = 0
let removed = 0
const noRecord = []
try {
  await client.query("BEGIN")
  for (const card of cards) {
    const userId = card.user?.id
    const { month, year } = card
    if (!userId || !month || !year) continue
    const record = await client.query("SELECT id FROM salary_records WHERE user_id = $1 AND month = $2 AND year = $3", [userId, month, year])
    if (!record.rows.length) noRecord.push(`${userId} ${year}-${month}`)
    const rows = (card.balances ?? []).map((item) => {
      const level = item.performance_indicator_level ?? null
      return {
        kpi_id: item.performance_indicator?.id,
        kpi_name: item.performance_indicator?.name ?? "",
        plan_type: item.performance_indicator?.plan_type ?? "",
        level: level?.level ?? null,
        level_from: num(level?.from_amount),
        level_to: num(level?.to_amount),
        calculation_type: level?.calculation_type ?? "",
        plan: num(item.plan_amount) ?? 0,
        sales: num(item.sales_amount),
        returns: num(item.return_amount),
        fact: num(item.fact_amount),
        bonus: num(item.bonus_amount) ?? 0,
        forecast: num(item.plan_forecast),
        daily_plan: num(item.daily_plan),
        daily_sales: num(item.daily_sales_amount),
        daily_returns: num(item.daily_return_amount),
        daily_fact: num(item.daily_fact_amount),
        last_date: item.last_date ?? null,
        linko_id: item.id ?? null,
      }
    }).filter((row) => row.kpi_id)
    const existing = (await client.query("SELECT * FROM salary_kpi_balances WHERE user_id = $1 AND month = $2 AND year = $3", [userId, month, year])).rows
    const key = (row) => `${row.kpi_id}/${row.level ?? ""}`
    const keep = new Set(rows.map(key))
    for (const old of existing) {
      if (keep.has(key(old))) continue
      await client.query("DELETE FROM salary_kpi_balances WHERE id = $1", [old.id])
      await register(client, run, "salary_kpi_balances", old.id, "delete", old)
      removed++
    }
    for (const row of rows) {
      const old = existing.find((item) => key(item) === key(row))
      const values = COLUMNS.map((column) => row[column])
      if (old) {
        if (COLUMNS.every((column) => String(old[column] ?? "") === String(row[column] ?? ""))) continue
        await client.query(`UPDATE salary_kpi_balances SET ${COLUMNS.map((column, index) => `${column} = $${index + 2}`).join(", ")} WHERE id = $1`, [old.id, ...values])
        await register(client, run, "salary_kpi_balances", old.id, "update", old)
        updated++
      } else {
        const result = await client.query(
          `INSERT INTO salary_kpi_balances (user_id, month, year, kpi_id, ${COLUMNS.join(", ")}) VALUES ($1, $2, $3, $4, ${COLUMNS.map((_, index) => `$${index + 5}`).join(", ")}) RETURNING id`,
          [userId, month, year, row.kpi_id, ...values],
        )
        await register(client, run, "salary_kpi_balances", result.rows[0].id, "insert")
        inserted++
      }
    }
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
console.log(`salary cards: ${cards.length} cards, balances inserted ${inserted}, updated ${updated}, removed ${removed}`)
if (noRecord.length) console.log(`salary cards: no local salary record for ${noRecord.length}: ${noRecord.slice(0, 20).join(", ")}`)
