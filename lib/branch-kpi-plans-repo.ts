import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { BranchKpiError, type BranchKpiBulkInput, type BranchKpiCopyInput, type BranchKpiListQuery, type BranchKpiRulesInput } from "@/lib/branch-kpi-api"
import {
  BRANCH_KPI_CALC_TYPE_IDS,
  branchKpiPeriod,
  branchKpiPlanType,
  type BranchKpiCalcType,
  type BranchKpiIndicator,
  type BranchKpiLevel,
  type BranchKpiListResult,
  type BranchKpiListRow,
} from "@/lib/branch-kpi-types"
import { loadCurrencyContext } from "@/lib/finance/context"
import { listKpiTasks } from "@/lib/kpi-tasks-repo"

// Storage of "KPI план филиалов" (demo staff/branch_performance/*):
// - branch_kpi_plans (existing table, one row per branch + "YYYY-MM" period):
//   its `plan` JSON text gains `indicators: {"<kpi id>": plan}`; any other keys
//   (the legacy planSales / bonusPercent) are preserved as they are.
// - branch_kpi_indicator_rules: reward levels + bonus fund of a KPI indicator
//   (our kpi_tasks rows have no levels; the demo keeps them on the indicator).
// - branch_kpi_balances / branch_kpi_recalcs: the "Перерасчет KPI" snapshot
//   (lib/branch-kpi-balance.ts) and its last_date.

declare global {
  var __linkoBranchKpiSchema: Promise<void> | undefined
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS branch_kpi_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_id INTEGER NOT NULL,
  branch_name TEXT NOT NULL,
  period TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(branch_id, period)
);
CREATE TABLE IF NOT EXISTS branch_kpi_indicator_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  indicator_id INTEGER NOT NULL UNIQUE,
  bonus_fund DOUBLE PRECISION NOT NULL DEFAULT 0,
  levels TEXT NOT NULL DEFAULT '[]',
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS branch_kpi_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,
  branch_id INTEGER NOT NULL,
  branch_name TEXT NOT NULL DEFAULT '',
  total_bonus DOUBLE PRECISION NOT NULL DEFAULT 0,
  balances TEXT NOT NULL DEFAULT '[]',
  calculated_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(period, branch_id)
);
CREATE TABLE IF NOT EXISTS branch_kpi_recalcs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL UNIQUE,
  last_date TEXT NOT NULL,
  calculated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);`

/** Creates the page's tables once per process. */
export function ensureBranchKpiSchema(): Promise<void> {
  if (!globalThis.__linkoBranchKpiSchema) {
    globalThis.__linkoBranchKpiSchema = getDb()
      .exec(SCHEMA_SQL)
      .catch((error: unknown) => {
        globalThis.__linkoBranchKpiSchema = undefined
        throw error
      })
  }
  return globalThis.__linkoBranchKpiSchema
}

async function tableExists(db: PgDb, table: string): Promise<boolean> {
  const row = (await db.prepare("SELECT to_regclass(@table) IS NOT NULL AS ok").get({ table })) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

// --- indicators -----------------------------------------------------------------

function finite(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

/** Stored levels JSON → ordered levels numbered 1…n. */
export function normalizeLevels(raw: unknown): BranchKpiLevel[] {
  let list: unknown = raw
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw)
    } catch {
      list = []
    }
  }
  if (!Array.isArray(list)) return []
  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: 0,
      fromAmount: finite(item.fromAmount),
      toAmount: finite(item.toAmount),
      bonus: finite(item.bonus),
      calculationType: (BRANCH_KPI_CALC_TYPE_IDS as readonly string[]).includes(String(item.calculationType))
        ? (String(item.calculationType) as BranchKpiCalcType)
        : "percentFromSales",
      excludeLowLevel: Boolean(item.excludeLowLevel),
    }))
    .sort((a, b) => a.fromAmount - b.fromAmount || a.toAmount - b.toAmount)
    .map((level, index) => ({ ...level, id: index + 1 }))
}

/** Every KPI indicator (our kpi_tasks, "KPI задачи") with its reward rules. */
export async function listBranchKpiIndicators(): Promise<BranchKpiIndicator[]> {
  await ensureBranchKpiSchema()
  const db = getDb()
  const [tasks, rules] = await Promise.all([
    listKpiTasks(),
    db.prepare("SELECT indicator_id, bonus_fund, levels FROM branch_kpi_indicator_rules").all() as Promise<
      Array<{ indicator_id: number; bonus_fund: number; levels: string }>
    >,
  ])
  const byId = new Map(rules.map((rule) => [Number(rule.indicator_id), rule]))
  return tasks.map((task) => {
    const type = branchKpiPlanType(task.planType)
    const rule = byId.get(task.id)
    return {
      id: task.id,
      name: task.name,
      planType: task.planType,
      planKey: type?.key ?? null,
      unit: type?.unit ?? "count",
      supported: Boolean(type?.supported),
      active: task.active,
      bonusFund: finite(rule?.bonus_fund),
      levels: normalizeLevels(rule?.levels ?? "[]"),
    }
  })
}

/** "Уровень вознаграждения" of one indicator (bonus fund + levels). */
export async function saveBranchKpiRules(indicatorId: number, input: BranchKpiRulesInput, userName: string): Promise<BranchKpiIndicator> {
  const indicators = await listBranchKpiIndicators()
  if (!indicators.some((item) => item.id === indicatorId)) throw new BranchKpiError("KPI не найден", 404)
  for (const level of input.levels) {
    if (level.toAmount <= level.fromAmount) throw new BranchKpiError("«До» должно быть больше «От»")
  }
  const levels = normalizeLevels(input.levels).map(({ fromAmount, toAmount, bonus, calculationType, excludeLowLevel }) => ({
    fromAmount,
    toAmount,
    bonus,
    calculationType,
    excludeLowLevel,
  }))
  await getDb()
    .prepare(
      `INSERT INTO branch_kpi_indicator_rules (indicator_id, bonus_fund, levels, updated_by)
       VALUES (@indicatorId, @bonusFund, @levels, @userName)
       ON CONFLICT (indicator_id) DO UPDATE SET bonus_fund = excluded.bonus_fund, levels = excluded.levels,
         updated_by = excluded.updated_by, updated_at = datetime('now')`,
    )
    .run({ indicatorId, bonusFund: input.bonusFund, levels: JSON.stringify(levels), userName })
  const saved = (await listBranchKpiIndicators()).find((item) => item.id === indicatorId)
  if (!saved) throw new BranchKpiError("KPI не найден", 404)
  return saved
}

// --- plans ----------------------------------------------------------------------

type PlanJson = Record<string, unknown> & { indicators?: Record<string, unknown> }

function parsePlanJson(text: unknown): PlanJson {
  if (typeof text !== "string" || !text.trim()) return {}
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === "object" && !Array.isArray(value) ? (value as PlanJson) : {}
  } catch {
    return {}
  }
}

function indicatorPlans(json: PlanJson): Map<number, number> {
  const out = new Map<number, number>()
  const map = json.indicators
  if (!map || typeof map !== "object" || Array.isArray(map)) return out
  for (const [key, value] of Object.entries(map)) {
    const id = Number(key)
    const plan = Number(value)
    if (Number.isInteger(id) && id > 0 && value !== null && value !== "" && Number.isFinite(plan)) out.set(id, plan)
  }
  return out
}

/** branch id → (indicator id → plan) of one period. */
export async function readPeriodPlans(db: PgDb, period: string): Promise<Map<number, Map<number, number>>> {
  await ensureBranchKpiSchema()
  const rows = (await db.prepare("SELECT branch_id, plan FROM branch_kpi_plans WHERE period = @period").all({ period })) as Array<{ branch_id: number; plan: string }>
  const out = new Map<number, Map<number, number>>()
  for (const row of rows) {
    const plans = indicatorPlans(parsePlanJson(row.plan))
    if (plans.size) out.set(Number(row.branch_id), plans)
  }
  return out
}

/** Applies `change` to the indicator plans of a branch/period row (created when missing), inside `tx`. */
async function updateBranchPlans(
  tx: PgDb,
  branch: { id: number; name: string },
  period: string,
  change: (plans: Map<number, number>) => void,
): Promise<void> {
  const row = (await tx
    .prepare("SELECT id, plan FROM branch_kpi_plans WHERE branch_id = @branchId AND period = @period FOR UPDATE")
    .get({ branchId: branch.id, period })) as { id: number; plan: string } | undefined
  const json = parsePlanJson(row?.plan)
  const plans = indicatorPlans(json)
  change(plans)
  const next: PlanJson = { ...json, indicators: Object.fromEntries([...plans.entries()].sort((a, b) => a[0] - b[0]).map(([id, plan]) => [String(id), plan])) }
  const text = JSON.stringify(next)
  if (row) {
    if (text !== row.plan) {
      await tx
        .prepare("UPDATE branch_kpi_plans SET plan = @plan, branch_name = @branchName, updated_at = datetime('now') WHERE id = @id")
        .run({ id: row.id, plan: text, branchName: branch.name })
    }
    return
  }
  if (!plans.size) return
  await tx
    .prepare(
      `INSERT INTO branch_kpi_plans (branch_id, branch_name, period, plan) VALUES (@branchId, @branchName, @period, @plan)
       ON CONFLICT (branch_id, period) DO UPDATE SET plan = excluded.plan, branch_name = excluded.branch_name, updated_at = datetime('now')`,
    )
    .run({ branchId: branch.id, branchName: branch.name, period, plan: text })
}

async function branchesById(db: PgDb, ids: number[]): Promise<Map<number, { id: number; name: string }>> {
  if (!ids.length || !(await tableExists(db, "branches"))) return new Map()
  const rows = (await db.prepare("SELECT id, name FROM branches WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{ id: number; name: string }>
  return new Map(rows.map((row) => [Number(row.id), { id: Number(row.id), name: String(row.name) }]))
}

/** "Изменить планы" (demo bulk_set_plan). Returns the number of branches written. */
export async function bulkSetBranchKpiPlans(input: BranchKpiBulkInput): Promise<number> {
  await ensureBranchKpiSchema()
  const db = getDb()
  const period = branchKpiPeriod(input.year, input.month)
  const indicatorIds = new Set((await listBranchKpiIndicators()).map((item) => item.id))
  const scope = new Set(input.indicators)
  for (const id of scope) if (!indicatorIds.has(id)) throw new BranchKpiError("KPI не найден", 404)
  for (const branch of input.branches) {
    for (const item of branch.performanceIndicators) {
      if (!indicatorIds.has(item.performanceIndicator)) throw new BranchKpiError("KPI не найден", 404)
    }
  }
  const branches = await branchesById(db, [...new Set(input.branches.map((item) => item.branch))])
  if (branches.size !== new Set(input.branches.map((item) => item.branch)).size) throw new BranchKpiError("Филиал не найден", 404)
  await withTransaction(async (tx) => {
    for (const item of input.branches) {
      await updateBranchPlans(tx, branches.get(item.branch)!, period, (plans) => {
        for (const id of scope) plans.delete(id)
        for (const entry of item.performanceIndicators) plans.set(entry.performanceIndicator, entry.plan)
      })
    }
  })
  return branches.size
}

/** "Дублировать" (demo copy): the plans of the chosen (or all) branches → another month. */
export async function copyBranchKpiPlans(input: BranchKpiCopyInput): Promise<number> {
  await ensureBranchKpiSchema()
  const from = branchKpiPeriod(input.fromYear, input.fromMonth)
  const to = branchKpiPeriod(input.toYear, input.toMonth)
  if (from === to) throw new BranchKpiError("Выберите другой месяц")
  const db = getDb()
  const source = await readPeriodPlans(db, from)
  const all = input.isAll || !input.branches.length
  const wanted = all ? [...source.keys()] : input.branches.filter((id) => source.has(id))
  const branches = await branchesById(db, wanted)
  if (!branches.size) return 0
  await withTransaction(async (tx) => {
    for (const branch of branches.values()) {
      const plans = source.get(branch.id)!
      await updateBranchPlans(tx, branch, to, (target) => {
        for (const [id, plan] of plans) target.set(id, plan)
      })
    }
  })
  return branches.size
}

// --- list -----------------------------------------------------------------------

export async function readLastDate(db: PgDb, period: string): Promise<string | null> {
  await ensureBranchKpiSchema()
  const row = (await db.prepare("SELECT last_date FROM branch_kpi_recalcs WHERE period = @period").get({ period })) as { last_date: string } | undefined
  return row?.last_date || null
}

export async function branchKpiLastDate(year: number, month: number): Promise<string | null> {
  return readLastDate(getDb(), branchKpiPeriod(year, month))
}

/** Demo GET staff/branch_performance/?month&year&search (+ ordering, paging). */
export async function listBranchKpi(query: BranchKpiListQuery): Promise<BranchKpiListResult> {
  await ensureBranchKpiSchema()
  const db = getDb()
  const period = branchKpiPeriod(query.year, query.month)
  const [cc, lastDate] = await Promise.all([loadCurrencyContext(db), readLastDate(db, period)])
  if (!(await tableExists(db, "branches"))) return { count: 0, results: [], currency: cc.base, lastDate }

  const [branches, plans, indicators, totals] = await Promise.all([
    db
      .prepare("SELECT id, name FROM branches WHERE @search::text = '' OR strpos(lower(name), lower(@search::text)) > 0 ORDER BY id")
      .all({ search: query.search }) as Promise<Array<{ id: number; name: string }>>,
    readPeriodPlans(db, period),
    listBranchKpiIndicators(),
    db.prepare("SELECT branch_id, total_bonus FROM branch_kpi_balances WHERE period = @period").all({ period }) as Promise<
      Array<{ branch_id: number; total_bonus: number }>
    >,
  ])
  const names = new Map(indicators.map((item) => [item.id, item.name]))
  const bonusByBranch = new Map(totals.map((row) => [Number(row.branch_id), Number(row.total_bonus)]))
  const rows: BranchKpiListRow[] = branches.map((branch) => ({
    id: Number(branch.id),
    name: String(branch.name),
    month: query.month,
    year: query.year,
    performanceIndicators: [...(plans.get(Number(branch.id)) ?? new Map<number, number>()).entries()]
      .filter(([id]) => names.has(id))
      .sort((a, b) => a[0] - b[0])
      .map(([id, plan]) => ({ id, name: names.get(id)!, plan })),
    totalBonus: bonusByBranch.has(Number(branch.id)) ? bonusByBranch.get(Number(branch.id))! : null,
  }))
  const direction = query.ordering.startsWith("-") ? -1 : 1
  if (query.ordering.endsWith("name")) {
    rows.sort((a, b) => direction * a.name.localeCompare(b.name, "ru") || a.id - b.id)
  } else if (query.ordering.endsWith("salary")) {
    rows.sort((a, b) => direction * ((a.totalBonus ?? -Infinity) - (b.totalBonus ?? -Infinity) || 0) || a.id - b.id)
  }
  const start = (query.page - 1) * query.pageSize
  return { count: rows.length, results: rows.slice(start, start + query.pageSize), currency: cc.base, lastDate }
}
