// «Выполнения KPI»: Linko keeps a snapshot per month (staff/staff_balance), computed when someone pressed «Перерасчет»
// and never after. This rebuilds the same snapshot here with this app's engine (lib/kpi-performance-repo.ts), from
// Linko's inputs only: the employees, KPIs and plans of each stored month (staff_balance_months) and the moment of its
// last recalculation (kpi_last_date_months, fetch.mjs step "months"). No Linko fact, level or bonus is copied: the
// facts are computed from the local documents as of that moment. Idempotent (each month's snapshot is replaced).
// Only «Выполнения KPI» (kpi_staff_balances, kpi_balance_dates) is written: the salary records and their row cards
// (salary_kpi_balances, import-salary-cards.mjs) keep Linko's own figures until «Перерасчет KPI» is pressed here.
//
//   node node_modules/tsx/dist/cli.mjs --conditions=react-server --tsconfig tsconfig.json scripts/linko-sync/import-kpi-balances.ts
//   (raw: the download every other step reads, lib.mjs rawDir(): RAW, else the newest full backups/linko-raw/<date>;
//   with RAW the step is skipped when RAW lacks a month file. TARGET_DB=<name> writes to that database of the same
//   server, with the same account check as the other importers; DRY=1 lists the months it would rebuild and writes
//   nothing; refuses a remote database unless ALLOW_REMOTE=1)
import fs from "node:fs"
import path from "node:path"

import { ROOT, appDatabase, rawDir, rawEnv, skipUnlessInRaw } from "./lib.mjs"

const FILES = ["staff_balance_months", "kpi_last_date_months"]

function raw<T>(dir: string, name: string): T {
  const file = path.join(dir, `${name}.json`)
  if (!fs.existsSync(file)) throw new Error(`Raw file missing: ${file} (fetch.mjs step "months")`)
  return JSON.parse(fs.readFileSync(file, "utf8")).data as T
}

type StaffRow = { user: { id: number }; performance_indicator: { id: number }; plan_amount: string }

async function main() {
  const dir = rawDir()
  // With RAW, a download without the month files skips the step (never another folder); without RAW a missing file
  // stops it, as before.
  if (rawEnv()) for (const file of FILES) skipUnlessInRaw(fs.existsSync(path.join(dir, `${file}.json`)) ? file : null, `${file}.json`)
  console.log(`kpi balances: raw ${path.relative(ROOT, dir) || dir}`)
  const dry = process.env.DRY === "1"
  // The app's pool reads DATABASE_URL: pointed at the target only after the account check (lib.mjs connect()).
  if (!dry) console.log(`kpi balances: database ${await appDatabase()}`)
  const engine = dry ? null : await import("@/lib/kpi-performance-repo")
  const months = raw<Record<string, StaffRow[] | { __status: number }>>(dir, "staff_balance_months")
  const dates = raw<Record<string, { last_date?: string | null } | { __status: number }>>(dir, "kpi_last_date_months")
  let done = 0
  for (const [ym, rows] of Object.entries(months).sort()) {
    if (!Array.isArray(rows) || !rows.length) continue
    const lastDate = (dates[ym] as { last_date?: string | null } | undefined)?.last_date
    if (!lastDate) {
      console.log(`${ym}: ${rows.length} rows in Linko but no recalculation date, skipped`)
      continue
    }
    const [year, month] = ym.split("-").map(Number)
    const plans = rows.map((row) => ({ userId: row.user.id, kpiId: row.performance_indicator.id, plan: Number(row.plan_amount) || 0 }))
    if (!engine) {
      console.log(`${ym}: ${plans.length} plans as of ${lastDate.slice(0, 19)} (dry run, nothing written)`)
      done += 1
      continue
    }
    const stored = await engine.recalculateKpiBalances(month, year, { at: lastDate.slice(0, 19), plans })
    console.log(`${ym}: ${stored.length} rows as of ${lastDate.slice(0, 19)} (${stored.filter((row) => row.fact === null).length} without a fact)`)
    done += 1
  }
  console.log(`kpi balances: ${done} months`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
