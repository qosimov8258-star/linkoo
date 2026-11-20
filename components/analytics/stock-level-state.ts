import { formatMoney } from "@/lib/finance/currency"
import type { StockLevelFilters, StockLevelMode, StockLevelUnit } from "@/lib/stock/level-types"
import { STOCK_LEVEL_MODES, STOCK_LEVEL_SORT_KEYS, STOCK_LEVEL_UNITS } from "@/lib/stock/level-types"

// URL state of the "Остаток" page (demo keeps every filter in the hash query):
// ?toggle=price|priceList&showIn=box|capacity|weight (Linko's names; the older mode= / unit= are still read)
//  &priceList=&search=&ordering=&page=&pageSize=&onlyHas=1
//  &warehouse=…&branch=…&type=…&subcategory=…&brand=…&supplier=…&organization=…&item=<key>
//  &dynamicList=<product id or item key> (the «Забронировано» list of that item, as Linko)

export type StockLevelState = {
  mode: StockLevelMode
  unit: StockLevelUnit
  priceList: string
  search: string
  ordering: string
  page: number
  pageSize: number
  filters: StockLevelFilters
  /** Item detail dialog (catalog key). */
  item: string
  /** «Забронировано» list of this item (catalog key), Linko's ?dynamicList=<product id>. */
  reserved: string
}

// Linko's toggle values ↔ the modes of the API.
const TOGGLE_TO_MODE: Record<string, StockLevelMode> = { quantity: "amount", price: "net_cost", priceList: "price" }
const MODE_TO_TOGGLE: Record<StockLevelMode, string> = { amount: "quantity", net_cost: "price", price: "priceList" }

/** ?dynamicList: a bare id is a product («product:12»), anything else an item key. */
export function reservedKeyFromParam(value: string): string {
  const text = value.trim()
  return /^\d+$/.test(text) ? `product:${text}` : text
}

/** The ?dynamicList value of an item key (a product's bare id, as Linko writes it). */
export function reservedParamOfKey(key: string): string {
  return key.replace(/^product:(\d+)$/, "$1")
}

export const STOCK_LEVEL_PAGE_SIZE = 25
export const STOCK_FILTER_LISTS = ["warehouse", "branch", "type", "subcategory", "brand", "supplier", "organization"] as const

export function emptyStockFilters(): StockLevelFilters {
  return { warehouse: [], branch: [], type: [], subcategory: [], brand: [], supplier: [], organization: [], onlyHas: false }
}

type ParamReader = { get(name: string): string | null; getAll(name: string): string[] }

export function stockStateFromParams(params: ParamReader): StockLevelState {
  const mode = (TOGGLE_TO_MODE[params.get("toggle") ?? ""] ?? params.get("mode")) as StockLevelMode | null
  const unit = (params.get("showIn") ?? params.get("unit")) as StockLevelUnit | null
  const ordering = params.get("ordering") ?? ""
  const filters = emptyStockFilters()
  for (const name of STOCK_FILTER_LISTS) filters[name] = params.getAll(name).filter((value) => value.trim())
  filters.onlyHas = params.get("onlyHas") === "1"
  const pageSize = Number(params.get("pageSize"))
  return {
    mode: mode && STOCK_LEVEL_MODES.includes(mode) ? mode : "amount",
    unit: unit && STOCK_LEVEL_UNITS.includes(unit) ? unit : "amount",
    priceList: params.get("priceList") ?? "",
    search: params.get("search") ?? "",
    ordering: (STOCK_LEVEL_SORT_KEYS as readonly string[]).includes(ordering.replace(/^-/, "")) ? ordering : "",
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: pageSize > 0 ? pageSize : STOCK_LEVEL_PAGE_SIZE,
    filters,
    item: params.get("item") ?? "",
    reserved: reservedKeyFromParam(params.get("dynamicList") ?? ""),
  }
}

export function stockStateToSearch(state: StockLevelState): string {
  const params = new URLSearchParams()
  if (state.mode !== "amount") params.set("toggle", MODE_TO_TOGGLE[state.mode])
  if (state.unit !== "amount") params.set("showIn", state.unit)
  if (state.priceList) params.set("priceList", state.priceList)
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  if (state.page > 1) params.set("page", String(state.page))
  if (state.pageSize !== STOCK_LEVEL_PAGE_SIZE) params.set("pageSize", String(state.pageSize))
  for (const name of STOCK_FILTER_LISTS) for (const value of state.filters[name]) params.append(name, value)
  if (state.filters.onlyHas) params.set("onlyHas", "1")
  if (state.item) params.set("item", state.item)
  if (state.reserved) params.set("dynamicList", reservedParamOfKey(state.reserved))
  return params.toString()
}

/** Query string of GET /api/stock/balances for the state (pageSize 0 = all rows). */
export function stockListQuery(state: StockLevelState, overrides: { page?: number; pageSize?: number } = {}): string {
  const params = new URLSearchParams()
  params.set("mode", state.mode)
  params.set("unit", state.unit)
  if (state.priceList) params.set("priceList", state.priceList)
  if (state.search) params.set("search", state.search)
  if (state.ordering) params.set("ordering", state.ordering)
  params.set("page", String(overrides.page ?? state.page))
  params.set("pageSize", String(overrides.pageSize ?? state.pageSize))
  for (const name of STOCK_FILTER_LISTS) for (const value of state.filters[name]) params.append(name, value)
  if (state.filters.onlyHas) params.set("onlyHas", "1")
  return params.toString()
}

/** Scope of the item detail (warehouse / branch filters only). */
export function stockScopeQuery(filters: StockLevelFilters): string {
  const params = new URLSearchParams()
  for (const value of filters.warehouse) params.append("warehouse", value)
  for (const value of filters.branch) params.append("branch", value)
  return params.toString()
}

export function countStockFilters(filters: StockLevelFilters): number {
  return STOCK_FILTER_LISTS.filter((name) => filters[name].length > 0).length + (filters.onlyHas ? 1 : 0)
}

/** "160 587" / "1,5": space thousands, comma decimals (as the other pages). */
export function formatQty(value: number, digits = 3): string {
  return formatMoney(value, digits)
}

/** "160 587 dona": quantity with its (translated) unit. */
export function qtyWithUnit(value: number, unit: string, t: (text: string) => string): string {
  return unit ? `${formatQty(value)} ${t(unit)}` : formatQty(value)
}
