// Shared (client + server) types and constants of "KPI план филиалов"
// (demo #/staff-branch/, API staff/branch_performance/*). See scratchpad
// extra/spec-branch-kpi.md for the reconstruction from the demo bundle.

/** Demo kpiPlanType (module 4309). `label` is the Russian text our KPI задачи
 * page stores in kpi_tasks.plan_type; `unit` drives formatting and the
 * "percent from sales" base; `supported` = our app has the data for the fact. */
export const BRANCH_KPI_PLAN_TYPES = [
  { key: "sales_sum", label: "Сумма фактической продажи (продажа - возврат)", unit: "money", supported: true },
  { key: "product_sales_amount", label: "Кол-во фактической продажи (продажа - возврат)", unit: "quantity", supported: true },
  { key: "sales_sum_order", label: "Сумма продаж (продажа-возврат от продаж)", unit: "money", supported: true },
  { key: "product_sales_amount_order", label: "Кол-во продаж (продажа-возврат от продаж)", unit: "quantity", supported: true },
  { key: "activate_count", label: "Активация неактивных", unit: "count", supported: true },
  { key: "active_client_count", label: "АКБ", unit: "count", supported: true },
  { key: "active_client_count_by_day", label: "Дневной АКБ", unit: "count", supported: true },
  { key: "payment_to_cashbox", label: "Оплата (принятые на кассу)", unit: "money", supported: true },
  { key: "product_sales_weight", label: "Вес фактической продажи (продажа - возврат)", unit: "weight", supported: true },
  { key: "visit", label: "Визит", unit: "count", supported: false },
  { key: "attendance", label: "Посещение", unit: "count", supported: false },
  { key: "delivered_weight", label: "Вес фактической доставки", unit: "weight", supported: true },
  { key: "delivered_product_amount", label: "Кол-во доставленных продуктов", unit: "quantity", supported: true },
  { key: "delivered_order_sum", label: "Сумма доставки (продажа-возврат от продаж)", unit: "money", supported: true },
  { key: "payed_market_count", label: "Количество оплативших клиентов", unit: "count", supported: true },
  { key: "mml", label: "Индикатор ММЛ / АКБ", unit: "percent", supported: false },
  { key: "plan_visit_by_day", label: "Плановый Визит ПО ДНЯМ", unit: "count", supported: false },
  { key: "perfect_store_visit_percent", label: "Perfect Store (% от визитов)", unit: "percent", supported: false },
  { key: "order_count", label: "Количество заказов", unit: "count", supported: true },
] as const

export type BranchKpiPlanKey = (typeof BRANCH_KPI_PLAN_TYPES)[number]["key"]
export type BranchKpiPlanUnit = (typeof BRANCH_KPI_PLAN_TYPES)[number]["unit"]

function planKeyText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

/** kpi_tasks.plan_type (Russian label, or a demo key) → plan type entry. */
export function branchKpiPlanType(planType: string) {
  const text = planKeyText(planType)
  return BRANCH_KPI_PLAN_TYPES.find((item) => item.key === text || planKeyText(item.label) === text) ?? null
}

/** Demo level calculation types (module 4308 `c`). */
export const BRANCH_KPI_CALC_TYPES = [
  { id: "percentFromSales", name: "Процент от продаж" },
  { id: "percentFromBonusAmount", name: "Процент от бонусные суммы" },
  { id: "percentFromBonusFund", name: "Процент от бонусного фонда" },
  { id: "bonus", name: "Единоразовый бонус" },
  { id: "percentFromSalesForAll", name: "Процент от продаж без учета предыдущих" },
  { id: "forEachUnit", name: "Бонус за каждую единицу" },
  { id: "percentFromBonusAmountForAll", name: "Процент от бонуса без учета предыдущих" },
] as const

export type BranchKpiCalcType = (typeof BRANCH_KPI_CALC_TYPES)[number]["id"]
export const BRANCH_KPI_CALC_TYPE_IDS = BRANCH_KPI_CALC_TYPES.map((item) => item.id) as [BranchKpiCalcType, ...BranchKpiCalcType[]]

export function branchKpiCalcTypeName(id: string): string {
  return BRANCH_KPI_CALC_TYPES.find((item) => item.id === id)?.name ?? id
}

/** Demo MonthsItems (module 369). */
export const BRANCH_KPI_MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"] as const

/** One reward level ("Уровень вознаграждения", module 5183 stages). */
export type BranchKpiLevel = {
  /** № (1-based, in order). */
  id: number
  /** Achievement % from (inclusive). */
  fromAmount: number
  /** Achievement % to. */
  toAmount: number
  bonus: number
  calculationType: BranchKpiCalcType
  /** "Обнулить предыдущие уровни". */
  excludeLowLevel: boolean
}

/** KPI indicator (our kpi_tasks row) + the bonus rules this page stores for it. */
export type BranchKpiIndicator = {
  id: number
  name: string
  /** kpi_tasks.plan_type as stored (Russian label). */
  planType: string
  planKey: BranchKpiPlanKey | null
  unit: BranchKpiPlanUnit
  /** Our app has data to compute the fact. */
  supported: boolean
  active: boolean
  bonusFund: number
  levels: BranchKpiLevel[]
}

export type BranchKpiPlanChip = { id: number; name: string; plan: number }

/** Demo list row (staff/branch_performance/). */
export type BranchKpiListRow = {
  id: number
  name: string
  month: number
  year: number
  performanceIndicators: BranchKpiPlanChip[]
  /** null until "Перерасчет KPI" ran for the month. */
  totalBonus: number | null
}

export type BranchKpiListResult = {
  count: number
  results: BranchKpiListRow[]
  /** Base currency code (demo CURRENCY_NAME_FOR_KPI || PRIMARY_CURRENCY). */
  currency: string
  /** Last recalculation of the month (demo last_date), local "YYYY-MM-DDTHH:mm:ss". */
  lastDate: string | null
}

/** One detail line (demo balances[]). Amount fields are null when our app has no data for the indicator. */
export type BranchKpiBalance = {
  performanceIndicator: { id: number; name: string; planType: string; supported: boolean }
  performanceIndicatorLevel: { level: number; fromAmount: number; toAmount: number } | null
  planAmount: number
  salesAmount: number | null
  returnAmount: number | null
  factAmount: number | null
  dailyPlan: number | null
  planForecast: number | null
  bonusAmount: number
}

export type BranchKpiDetail = {
  id: number
  name: string
  month: number
  year: number
  /** "Фикс. зарплата" (branches have none → 0). */
  salary: number
  currency: string
  balances: BranchKpiBalance[]
  lastDate: string | null
}

export type BranchKpiRecalcResult = { lastDate: string; branches: number }

export function branchKpiPeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`
}
