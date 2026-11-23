// The arithmetic of «Выполнения KPI» (Linko's staff/staff_balance), without any data access, so it can be checked on
// its own. Every rule here was read off Linko's stored rows (283 rows of 16 months, see lib/kpi-performance-repo.ts):
// - level / bonus (all 283 rows): the level is the last level whose "from" (% of the plan) the fact reaches — a fact above
//   the last level stays in the last level. The bonus adds the contribution of that level, then of each lower level,
//   and stops after the first level marked «Исключить нижний уровень» (exclude_low_level). Linko's salary card
//   (staff/salary/<id>/ → balances) keeps one balance per level of that chain, each with its own contribution as the
//   bonus (all 265 KPIs of its 151 captured cards). A level contributes by its calculation type (a = the level's
//   amount, p = fact / plan × 100, [from, to] its range in %):
//     bonus                              a (fixed)
//     percent_from_sales                 plan × (min(p, to) − from) / 100 × a / 100 (only the slice of the range)
//     percent_from_sales_for_all         min(fact, plan × to / 100) × a / 100 (everything up to the level's top)
//     for_each_unit                      plan × (min(p, to) − from) / 100 × a
//     for_each_unit_same_bonus_for_all   min(fact, plan × to / 100) × a
//     percent_from_bonus_amount          a × (min(p, to) − from) / 100
//     percent_from_bonus_amount_for_all  a × min(p, to) / 100
//     percent_from_bonus_fund            bonus_fund × a / 100
// - days: the work days of the month of the calculation (its days minus the holidays of Посещаемость), T = how many, P =
//   how many of them are on or before the calculation day. Linko counts both in the month of the calculation, also when
//   it recalculates an earlier month.
// - daily plan = (plan − (fact − today's fact)) / (T − P + 1), never below 0; rounded half up, rounded up for the count
//   types (АКБ, визиты …). The salary card keeps it unrounded (47.25, 16.666666667 where «Выполнения KPI» has 47 / 17);
//   for the count types both are rounded up.
// - forecast = fact / P × (T − 1) when the calculation's month number is the KPI month's (Linko compares the month only,
//   not the year), else the fact; rounded up for the count types.
// - fact % and forecast % are rounded half up to whole percents (the KPI cards: to one decimal).

export type KpiLevelRule = {
  calculation_type?: string
  from_amount?: string | number | null
  to_amount?: string | number | null
  bonus_amount?: string | number | null
  exclude_low_level?: boolean
}

export type KpiDetailRule = { levels?: KpiLevelRule[] | null; bonus_fund?: string | number | null }

/** Plan types whose fact is a count: their forecast and daily plan are rounded up. */
export const KPI_COUNT_TYPES = new Set([
  "active_client_count",
  "active_client_count_by_day",
  "visit",
  "payed_market_count",
  "activate_count",
  "order_count",
  "mml",
  "attendance",
])

const num = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function roundHalfUp(value: number, digits = 0): number {
  const factor = 10 ** digits
  return Math.floor(value * factor + 0.5 + 1e-9) / factor
}

type Level = { type: string; from: number; to: number; amount: number; exclude: boolean; number: number }

/** The levels by their "from" %, numbered 1, 2 … in that order (Linko's level numbers are that order in every KPI). */
function levelsOf(detail: KpiDetailRule | null | undefined): Level[] {
  return (detail?.levels ?? [])
    .map((level) => ({
      type: String(level.calculation_type ?? ""),
      from: num(level.from_amount),
      to: num(level.to_amount),
      amount: num(level.bonus_amount),
      exclude: Boolean(level.exclude_low_level),
      number: 0,
    }))
    .sort((a, b) => a.from - b.from)
    .map((level, index) => ({ ...level, number: index + 1 }))
}

/** One level of a KPI with what it adds to the bonus (a balance of Linko's salary card). */
export type KpiLevelPart = { level: number; from: number; to: number; calculationType: string; bonus: number }

function contribution(level: Level, fundAmount: number, fact: number, plan: number, percent: number): number {
  const slice = Math.max(0, Math.min(percent, level.to) - level.from)
  switch (level.type) {
    case "bonus":
      return level.amount
    case "percent_from_sales":
      return ((plan * slice) / 100) * (level.amount / 100)
    case "percent_from_sales_for_all":
      return Math.min(fact, (plan * level.to) / 100) * (level.amount / 100)
    case "for_each_unit":
      return ((plan * slice) / 100) * level.amount
    case "for_each_unit_same_bonus_for_all":
      return Math.min(fact, (plan * level.to) / 100) * level.amount
    case "percent_from_bonus_amount":
      return (level.amount * slice) / 100
    case "percent_from_bonus_amount_for_all":
      return (level.amount * Math.min(percent, level.to)) / 100
    case "percent_from_bonus_fund":
      return (fundAmount * level.amount) / 100
    default:
      return 0
  }
}

/** Level (1-based; 1 when no level is reached) and bonus of a fact against a plan, with the levels that make up the
 * bonus (from the reached level down to the first «Исключить нижний уровень»; none when no level is reached). */
export function kpiLevelBreakdown(detail: KpiDetailRule | null | undefined, fact: number, plan: number): { level: number; bonus: number; parts: KpiLevelPart[] } {
  const levels = levelsOf(detail)
  if (!levels.length) return { level: 1, bonus: 0, parts: [] }
  const percent = plan ? (fact / plan) * 100 : 0
  let reached = -1
  levels.forEach((level, index) => {
    if (percent >= level.from) reached = index
  })
  if (reached < 0) return { level: 1, bonus: 0, parts: [] }
  const fund = num(detail?.bonus_fund)
  let bonus = 0
  const parts: KpiLevelPart[] = []
  for (let index = reached; index >= 0; index -= 1) {
    const level = levels[index]
    const part = contribution(level, fund, fact, plan, percent)
    bonus += part
    parts.push({ level: level.number, from: level.from, to: level.to, calculationType: level.type, bonus: part })
    if (level.exclude) break
  }
  return { level: reached + 1, bonus, parts: parts.reverse() }
}

/** The lowest level of a KPI (Linko's staff row of a fact below every level still names level 1), or null without levels. */
export function kpiFirstLevel(detail: KpiDetailRule | null | undefined): Omit<KpiLevelPart, "bonus"> | null {
  const level = levelsOf(detail)[0]
  return level ? { level: level.number, from: level.from, to: level.to, calculationType: level.type } : null
}

/** Level number `number` (1-based, the order of kpiLevelBreakdown) of a KPI, or null when it has no such level. */
export function kpiLevelOf(detail: KpiDetailRule | null | undefined, number: number): Omit<KpiLevelPart, "bonus"> | null {
  const level = levelsOf(detail).find((item) => item.number === number)
  return level ? { level: level.number, from: level.from, to: level.to, calculationType: level.type } : null
}

/** Level (1-based; 1 when no level is reached) and bonus of a fact against a plan. */
export function kpiLevelAndBonus(detail: KpiDetailRule | null | undefined, fact: number, plan: number): { level: number; bonus: number } {
  const { level, bonus } = kpiLevelBreakdown(detail, fact, plan)
  return { level, bonus }
}

/** Work days of a month: its days minus the holidays ("YYYY-MM-DD"). total = T, passed = P (on or before `day`). */
export function workDaysAt(year: number, month: number, day: number, holidays: Iterable<string>): { total: number; passed: number } {
  const off = new Set(holidays)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  let total = 0
  let passed = 0
  for (let d = 1; d <= last; d += 1) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    if (off.has(iso)) continue
    total += 1
    if (d <= day) passed += 1
  }
  return { total, passed }
}

export type KpiRowNumbers = {
  dailyPlan: number
  /** The daily plan before rounding (rounded up for the count types, like dailyPlan): the salary card's figure. */
  dailyPlanExact: number
  forecast: number
  factPercent: number
  forecastPercent: number
  dailyFactPercent: number
}

/** The derived numbers of one row (see the header). `calcMonth` is the month (1..12) of the calculation date. */
export function kpiRowNumbers(input: {
  planType: string
  plan: number
  fact: number
  dailyFact: number
  kpiMonth: number
  calcMonth: number
  total: number
  passed: number
}): KpiRowNumbers {
  const count = KPI_COUNT_TYPES.has(input.planType)
  const remaining = input.total - input.passed + 1
  const rawDaily = remaining > 0 ? (input.plan - (input.fact - input.dailyFact)) / remaining : 0
  const dailyPlanExact = Math.max(0, count ? Math.ceil(rawDaily - 1e-9) : rawDaily)
  const dailyPlan = Math.max(0, count ? dailyPlanExact : roundHalfUp(rawDaily))
  let forecast = input.calcMonth === input.kpiMonth && input.passed > 0 ? (input.fact / input.passed) * (input.total - 1) : input.fact
  if (count) forecast = Math.ceil(forecast - 1e-9)
  const percent = (value: number, of: number) => (of ? roundHalfUp((value / of) * 100) : 0)
  return {
    dailyPlan,
    dailyPlanExact,
    forecast,
    factPercent: percent(input.fact, input.plan),
    forecastPercent: percent(forecast, input.plan),
    dailyFactPercent: percent(input.dailyFact, dailyPlan),
  }
}
