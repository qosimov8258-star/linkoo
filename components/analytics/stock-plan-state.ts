import { formatCashDate } from "@/components/analytics/cash-management-shared"
import { isIsoDay } from "@/lib/finance/dates"
import { formatMoney } from "@/lib/finance/currency"
import { PLAN_PAGE_SIZES, PLAN_TABS, type PlanTab, type PlanTaskTab } from "@/lib/stock-plan-types"

// URL state of "План приемок и передач". Keys (demo filter keys where they exist):
//   tab=receive|transfer|movement|receive_history|transfer_history (default receive)
//   stock* type (task tabs: one type; movement: type*) acceptedBy* fromDate toDate
//   search ordering page pageSize id=<type>-<id> (expanded row)
//   movement only: product* typeParent* typeChild*
// Switching tabs starts from an empty query, as the demo does.

export type PlanState = {
  tab: PlanTab
  warehouses: string[]
  /** Task tabs: one PlanTaskType ("" = all). */
  type: string
  /** Movement: PLAN_MOVE_TYPES ids. */
  moveTypes: string[]
  doneBy: string[]
  from: string
  to: string
  search: string
  ordering: string
  page: number
  pageSize: number
  /** Expanded task row: "supply-12" / "transfer-5" / "order-3". */
  detail: string
  products: string[]
  typeParents: string[]
  subcategories: string[]
}

function values(params: URLSearchParams, name: string): string[] {
  return [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))]
}

export function planStateFromParams(params: URLSearchParams): PlanState {
  const tabRaw = params.get("tab") ?? ""
  const tab = (PLAN_TABS as readonly string[]).includes(tabRaw) ? (tabRaw as PlanTab) : "receive"
  const fromRaw = params.get("fromDate") ?? ""
  const toRaw = params.get("toDate") ?? ""
  let from = isIsoDay(fromRaw) ? fromRaw : ""
  let to = isIsoDay(toRaw) ? toRaw : ""
  if (from && to && from > to) [from, to] = [to, from]
  const page = Math.floor(Number(params.get("page")))
  const size = Number(params.get("pageSize"))
  const types = values(params, "type")
  return {
    tab,
    warehouses: values(params, "stock"),
    type: tab === "movement" ? "" : (types[0] ?? ""),
    moveTypes: tab === "movement" ? types : [],
    doneBy: values(params, "acceptedBy"),
    from,
    to,
    search: (params.get("search") ?? "").trim(),
    ordering: (params.get("ordering") ?? "").trim(),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: (PLAN_PAGE_SIZES as readonly number[]).includes(size) ? size : 25,
    detail: (params.get("id") ?? "").trim(),
    products: values(params, "product"),
    typeParents: values(params, "typeParent"),
    subcategories: values(params, "typeChild"),
  }
}

/** "Фильтр: N элемента" — active filter keys (the period counts once). */
export function countPlanFilters(state: PlanState): number {
  const lists = state.tab === "movement" ? [state.warehouses, state.moveTypes, state.products, state.typeParents, state.subcategories] : [state.warehouses, state.doneBy]
  return lists.filter((list) => list.length > 0).length + (state.type ? 1 : 0) + (state.from || state.to ? 1 : 0)
}

/** URL changes that clear every filter of the tab (search included). */
export const CLEAR_PLAN_FILTERS = { stock: null, type: null, acceptedBy: null, fromDate: null, toDate: null, product: null, typeParent: null, typeChild: null, search: null, page: null, id: null }

function query(entries: Array<[string, string | number | string[] | undefined]>): string {
  const params = new URLSearchParams()
  for (const [name, value] of entries) {
    if (Array.isArray(value)) value.forEach((item) => params.append(name, item))
    else if (value !== undefined && value !== "") params.set(name, String(value))
  }
  return params.toString()
}

/** GET /api/stock/plan query of a task tab (pageSize 0 = every row, for Excel). */
export function taskApiQuery(state: PlanState, tab: PlanTaskTab, pageSize = state.pageSize): string {
  return query([
    ["tab", tab],
    ["warehouse", state.warehouses],
    ["type", state.type],
    ["doneBy", state.doneBy],
    ["from", state.from],
    ["to", state.to],
    ["search", state.search],
    ["ordering", state.ordering],
    ["page", pageSize ? state.page : 1],
    ["pageSize", pageSize],
  ])
}

/** GET /api/stock/plan/movements query (pageSize 0 = every row, for "Скачать все"). */
export function moveApiQuery(state: PlanState, pageSize = state.pageSize): string {
  return query([
    ["warehouse", state.warehouses],
    ["type", state.moveTypes],
    ["product", state.products],
    ["typeParent", state.typeParents],
    ["subcategory", state.subcategories],
    ["from", state.from],
    ["to", state.to],
    ["search", state.search],
    ["ordering", state.ordering],
    ["page", pageSize ? state.page : 1],
    ["pageSize", pageSize],
  ])
}

export function countsApiQuery(state: PlanState): string {
  return query([["warehouse", state.warehouses]])
}

/** "08 окт. 2026, 22:08" (no time when the document only has a day); "" stays "". */
export function planDate(iso: string, language: string): string {
  if (!iso) return ""
  return formatCashDate(iso, language, iso.length > 10 && !iso.endsWith("T00:00:00"))
}

/** "160 587 dona" / "-1,5 kg": space thousands, comma decimals, translated unit. */
export function planQty(value: number, unit: string, t: (text: string) => string, signed = false): string {
  const number = formatMoney(value, 3)
  return `${signed && value > 0 ? "+" : ""}${number}${unit ? ` ${t(unit)}` : ""}`
}
