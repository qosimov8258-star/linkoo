import "server-only"

import { getDb, withTransaction } from "@/lib/db"
import { computeBranchFacts, type BranchFactKey, type BranchFacts } from "@/lib/branch-kpi-facts"
import { ensureBranchKpiSchema, listBranchKpiIndicators, readLastDate, readPeriodPlans } from "@/lib/branch-kpi-plans-repo"
import { branchKpiPeriod, type BranchKpiBalance, type BranchKpiDetail, type BranchKpiIndicator, type BranchKpiLevel, type BranchKpiRecalcResult } from "@/lib/branch-kpi-types"
import { loadCurrencyContext } from "@/lib/finance/context"
import { roundMoney } from "@/lib/finance/currency"
import { ensureFinanceSchema } from "@/lib/finance/schema"

// "Перерасчет KPI" (demo POST staff/branch_performance/recalc_balance/ {month,
// type: "all", year}): computes every planned branch's balances for the month
// and stores them (branch_kpi_balances) with the month's last_date. The list's
// "Сумма бонусов" and the detail read that snapshot, like the demo.
//
// Formulas (server side in the demo, reconstructed — spec §8):
//   % = fact / plan · 100; level = the last level whose "от" ≤ % (needs % > 0); levels
//   accumulate from level 1 up to the reached one, a level with "Обнулить
//   предыдущие уровни" or a "… без учета предыдущих" type drops the previous;
//   level bonus: Процент от продаж = sales · bonus / 100 (sales = the fact of a
//   money indicator, else the branch's actual sales sum), Процент от бонусной
//   суммы / бонусного фонда = bonus fund · bonus / 100, Единоразовый = bonus,
//   За каждую единицу = fact · bonus.
//   Дневной план = max(plan − fact, 0) / remaining days of the month (incl.
//   today; 0 once the month is over); Прогноз = fact / elapsed days · days in
//   month (current month), fact (past month), 0 (future month).

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000

type MonthClock = { days: number; elapsed: number; remaining: number; state: "past" | "current" | "future" }

function pad(value: number): string {
  return String(value).padStart(2, "0")
}

function localNow(): Date {
  return new Date(Date.now() + TASHKENT_OFFSET_MS)
}

/** Local (Asia/Tashkent) "YYYY-MM-DDTHH:mm:ss". */
function localStamp(date = localNow()): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

function monthClock(year: number, month: number, now = localNow()): MonthClock {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth()
  const target = year * 12 + (month - 1)
  if (target < current) return { days, elapsed: days, remaining: 0, state: "past" }
  if (target > current) return { days, elapsed: 0, remaining: days, state: "future" }
  const today = now.getUTCDate()
  return { days, elapsed: today, remaining: days - today + 1, state: "current" }
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
  return { from: `${year}-${pad(month)}-01`, to: `${next.year}-${pad(next.month)}-01` }
}

function levelBonus(level: BranchKpiLevel, indicator: BranchKpiIndicator, fact: number, branchSales: number): number {
  switch (level.calculationType) {
    case "percentFromSales":
    case "percentFromSalesForAll":
      return ((indicator.unit === "money" ? fact : branchSales) * level.bonus) / 100
    case "percentFromBonusAmount":
    case "percentFromBonusAmountForAll":
    case "percentFromBonusFund":
      return (indicator.bonusFund * level.bonus) / 100
    case "bonus":
      return level.bonus
    case "forEachUnit":
      return fact * level.bonus
  }
}

/** One balance line of a planned indicator. */
export function computeBalance(indicator: BranchKpiIndicator, plan: number, facts: BranchFacts | undefined, clock: MonthClock): BranchKpiBalance {
  const head = { id: indicator.id, name: indicator.name, planType: indicator.planType, supported: indicator.supported }
  if (!indicator.supported || !indicator.planKey) {
    return {
      performanceIndicator: head,
      performanceIndicatorLevel: null,
      planAmount: plan,
      salesAmount: null,
      returnAmount: null,
      factAmount: null,
      dailyPlan: null,
      planForecast: null,
      bonusAmount: 0,
    }
  }
  const sales = facts?.[indicator.planKey as BranchFactKey] ?? 0
  const returns = 0
  const fact = sales - returns
  const percent = plan > 0 ? (fact / plan) * 100 : 0
  // No plan or no achievement yet → no level (a 0 % fact never "reaches" a level starting at 0 %).
  const reached = plan > 0 && percent > 0 ? indicator.levels.filter((level) => level.fromAmount <= percent) : []
  let bonus = 0
  for (const level of reached) {
    if (level.excludeLowLevel || level.calculationType.endsWith("ForAll")) bonus = 0
    bonus += levelBonus(level, indicator, fact, facts?.sales_sum ?? 0)
  }
  const current = reached[reached.length - 1]
  const forecast = clock.state === "current" ? (clock.elapsed ? (fact / clock.elapsed) * clock.days : 0) : clock.state === "past" ? fact : 0
  return {
    performanceIndicator: head,
    performanceIndicatorLevel: current ? { level: current.id, fromAmount: current.fromAmount, toAmount: current.toAmount } : null,
    planAmount: plan,
    salesAmount: roundMoney(sales, 3),
    returnAmount: returns,
    factAmount: roundMoney(fact, 3),
    dailyPlan: roundMoney(clock.remaining ? Math.max(plan - fact, 0) / clock.remaining : 0, 3),
    planForecast: roundMoney(forecast, 3),
    bonusAmount: roundMoney(bonus, 2),
  }
}

/** Recalculates the month for every branch that has plans; replaces the month's snapshot. */
export async function recalcBranchKpi(year: number, month: number, userName: string): Promise<BranchKpiRecalcResult> {
  await ensureBranchKpiSchema()
  const db = getDb()
  const period = branchKpiPeriod(year, month)
  const s = await ensureFinanceSchema(db)
  const [cc, indicators, plans] = await Promise.all([loadCurrencyContext(db), listBranchKpiIndicators(), readPeriodPlans(db, period)])
  const byId = new Map(indicators.map((item) => [item.id, item]))
  const branchIds = [...plans.keys()]
  const branches =
    branchIds.length && s.has("branches")
      ? ((await db.prepare("SELECT id, name FROM branches WHERE id = ANY(@ids::int[]) ORDER BY id").all({ ids: branchIds })) as Array<{ id: number; name: string }>)
      : []
  const { from, to } = monthRange(year, month)
  const facts = branches.length ? await computeBranchFacts(db, s, cc.base, from, to) : new Map<number, BranchFacts>()
  const clock = monthClock(year, month)
  const lastDate = localStamp()

  const snapshot = branches
    .map((branch) => {
      const balances = [...(plans.get(Number(branch.id)) ?? new Map<number, number>()).entries()]
        .filter(([id]) => byId.has(id))
        .sort((a, b) => a[0] - b[0])
        .map(([id, plan]) => computeBalance(byId.get(id)!, plan, facts.get(Number(branch.id)), clock))
      return { branch, balances, total: roundMoney(balances.reduce((sum, item) => sum + item.bonusAmount, 0), 2) }
    })
    .filter((item) => item.balances.length)

  await withTransaction(async (tx) => {
    await tx.prepare("DELETE FROM branch_kpi_balances WHERE period = @period").run({ period })
    for (const item of snapshot) {
      await tx
        .prepare(
          `INSERT INTO branch_kpi_balances (period, branch_id, branch_name, total_bonus, balances, calculated_at)
           VALUES (@period, @branchId, @branchName, @total, @balances, @lastDate)`,
        )
        .run({ period, branchId: item.branch.id, branchName: item.branch.name, total: item.total, balances: JSON.stringify(item.balances), lastDate })
    }
    await tx
      .prepare(
        `INSERT INTO branch_kpi_recalcs (period, last_date, calculated_by) VALUES (@period, @lastDate, @userName)
         ON CONFLICT (period) DO UPDATE SET last_date = excluded.last_date, calculated_by = excluded.calculated_by, updated_at = datetime('now')`,
      )
      .run({ period, lastDate, userName })
  })
  return { lastDate, branches: snapshot.length }
}

function parseBalances(text: unknown): BranchKpiBalance[] {
  if (typeof text !== "string") return []
  try {
    const value = JSON.parse(text) as unknown
    return Array.isArray(value) ? (value as BranchKpiBalance[]) : []
  } catch {
    return []
  }
}

/** Demo GET staff/branch_performance/:id/?month&year — the branch's stored balances. */
export async function getBranchKpiDetail(id: number, year: number, month: number): Promise<BranchKpiDetail | null> {
  await ensureBranchKpiSchema()
  const db = getDb()
  const period = branchKpiPeriod(year, month)
  const exists = (await db.prepare("SELECT to_regclass('branches') IS NOT NULL AS ok").get()) as { ok: boolean }
  if (!exists.ok) return null
  const branch = (await db.prepare("SELECT id, name FROM branches WHERE id = @id").get({ id })) as { id: number; name: string } | undefined
  if (!branch) return null
  const [row, cc, lastDate, indicators] = await Promise.all([
    db.prepare("SELECT balances FROM branch_kpi_balances WHERE period = @period AND branch_id = @id").get({ period, id }) as Promise<{ balances: string } | undefined>,
    loadCurrencyContext(db),
    readLastDate(db, period),
    listBranchKpiIndicators(),
  ])
  const current = new Map(indicators.map((item) => [item.id, item]))
  const balances = parseBalances(row?.balances).map((balance) => {
    const indicator = current.get(Number(balance.performanceIndicator?.id))
    return indicator ? { ...balance, performanceIndicator: { ...balance.performanceIndicator, name: indicator.name, planType: indicator.planType } } : balance
  })
  return { id: Number(branch.id), name: String(branch.name), month, year, salary: 0, currency: cc.base, balances, lastDate }
}
