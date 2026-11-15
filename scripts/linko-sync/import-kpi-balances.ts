// «Выполнения KPI»: Linko keeps a snapshot per month (staff/staff_balance), computed when someone pressed «Перерасчет»
// and never after. This rebuilds the same snapshot here with this app's engine (lib/kpi-performance-repo.ts), from
// Linko's inputs only: the employees, KPIs and plans of each stored month (staff_balance_months) and the moment of its
// last recalculation (kpi_last_date_months, fetch.mjs step "months"). No Linko fact, level or bonus is copied: the
// facts are computed from the local documents as of that moment. Idempotent (each month's snapshot is replaced).
//
//   node node_modules/tsx/dist/cli.mjs --conditions=react-server --tsconfig tsconfig.json scripts/linko-sync/import-kpi-balances.ts
//   (RAW=<raw folder> to read another download; refuses a remote database unless ALLOW_REMOTE=1)
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(__dirname, "../..")

function rawDir(): string {
  if (process.env.RAW) return process.env.RAW
  const base = path.join(ROOT, "backups", "linko-raw")
  const days = fs.existsSync(base) ? fs.readdirSync(base).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort() : []
  if (!days.length) throw new Error("No raw data: run scripts/linko-sync/fetch.mjs first")
  return path.join(base, days[days.length - 1])
}

function raw<T>(name: string): T {
  const file = path.join(rawDir(), `${name}.json`)
  if (!fs.existsSync(file)) throw new Error(`Raw file missing: ${file} (fetch.mjs step "months")`)
  return JSON.parse(fs.readFileSync(file, "utf8")).data as T
}

function loadEnv() {
  if (!process.env.DATABASE_URL) {
    const envFile = path.join(ROOT, ".env")
    const match = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").match(/^DATABASE_URL=(.*)$/m) : null
    if (!match) throw new Error("DATABASE_URL is not set")
    process.env.DATABASE_URL = match[1].trim()
  }
  const host = new URL(process.env.DATABASE_URL).hostname
  if (!["localhost", "127.0.0.1", "::1"].includes(host) && process.env.ALLOW_REMOTE !== "1") {
    throw new Error(`Refusing to write to ${host}: set ALLOW_REMOTE=1 to sync a non-local database`)
  }
}

type StaffRow = { user: { id: number }; performance_indicator: { id: number }; plan_amount: string }

async function main() {
  loadEnv()
  const { recalculateKpiBalances } = await import("@/lib/kpi-performance-repo")
  const months = raw<Record<string, StaffRow[] | { __status: number }>>("staff_balance_months")
  const dates = raw<Record<string, { last_date?: string | null } | { __status: number }>>("kpi_last_date_months")
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
    const stored = await recalculateKpiBalances(month, year, { at: lastDate.slice(0, 19), plans })
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
