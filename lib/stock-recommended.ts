import "server-only"

import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { linkedWarehouseNames } from "@/lib/user-warehouses"
import { getDb, type PgDb } from "@/lib/db"
import { isIsoDay, todayIso } from "@/lib/finance/dates"
import { stockOrphanNames } from "@/lib/stock/level"
import { getStockBalances, getStockCatalog, getStockPending } from "@/lib/stock/ledger"
import type { StockCatalogItem } from "@/lib/stock/types"
import { convertRecommended, defaultRecommendedPeriod, recommendedNumbers, type RecommendedNumbers } from "@/lib/stock-recommended-calc"
import { parsePageParam } from "@/lib/stock/paging"
import { notSignedInResponse, invalidFieldResponse } from "@/lib/validation"

// "Рекомендованный запас" (demo #/recommended-stock, API stock/recommended_balances):
// per item with sales in the period —
//   sold        = Σ order lines of every order that is not «Отменен» (whatever its status: Не подтвержден, Есть на
//                 складе, В пути, Доставлено…), on the order's creation day (Tashkent), from the chosen warehouses —
//                 Linko's rule, equal to its API for 2025, 2026, 2026-03 and the default period
//   days        = distinct creation days of those orders
//   available   = on hand now − defects − reserved (getStockBalances / getStockPending)
//   by_day, remain_days, 6- / 30-day recommendations, share of sales: see
//   lib/stock-recommended-calc.ts. Default order: Запас дней ascending, then the product id (Linko's).

export type RecommendedUnit = "measurement" | "weight" | "capacity" | "box"

export type RecommendedFilters = {
  from: string
  to: string
  warehouses: string[]
  organizations: string[]
  types: string[]
  subcategories: string[]
  brands: string[]
  search: string
  unit: RecommendedUnit
}

export type RecommendedRow = RecommendedNumbers & {
  key: string
  name: string
  article: string
  /** Unit of the numbers ("шт", "кг", "м³"). */
  unit: string
  type: string
  brand: string
  /** Вес одной ед. (kg). */
  weight: number
}

export type RecommendedSalesSource = {
  /** orders.warehouse exists (added lazily by the stock core). */
  warehouseColumn: boolean
  /** Orders with a warehouse (any status). */
  ordersWithWarehouse: number
  /** Order movements in the period (all items, all warehouses). */
  orderMovements: number
}

export type RecommendedListResult = {
  from: string
  to: string
  unit: RecommendedUnit
  count: number
  page: number
  pageSize: number
  totalSold: number
  results: RecommendedRow[]
  sales: RecommendedSalesSource
}

const UNITS = new Set<RecommendedUnit>(["measurement", "weight", "capacity", "box"])
const SORT_KEYS = new Set(["name", "weight", "sold", "salePart", "available", "byDay", "remainDays", "week", "month"])

function list(params: URLSearchParams, name: string): string[] {
  return [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))]
}

export function parseRecommendedFilters(params: URLSearchParams): { filters: RecommendedFilters; error?: undefined } | { filters?: undefined; error: string } {
  const fromRaw = params.get("from") ?? ""
  const toRaw = params.get("to") ?? ""
  if (fromRaw && !isIsoDay(fromRaw)) return { error: "from" }
  if (toRaw && !isIsoDay(toRaw)) return { error: "to" }
  const fallback = defaultRecommendedPeriod(todayIso())
  let from = fromRaw || fallback.from
  let to = toRaw || fallback.to
  if (from > to) [from, to] = [to, from]
  const unit = (params.get("unit") ?? "measurement") as RecommendedUnit
  return {
    filters: {
      from,
      to,
      warehouses: list(params, "warehouse"),
      organizations: list(params, "organization"),
      types: list(params, "type"),
      subcategories: list(params, "subcategory"),
      brands: list(params, "brand"),
      search: (params.get("search") ?? "").trim(),
      unit: UNITS.has(unit) ? unit : "measurement",
    },
  }
}

/** Order lines of the period (not cancelled) per item: sold, distinct creation days, lines. */
function salesSql(withWarehouses: boolean): string {
  return `SELECT s.item_key, SUM(s.qty) AS sold, COUNT(DISTINCT s.day) AS days, COUNT(*) AS lines FROM (
      SELECT CASE WHEN oi.product_id IS NOT NULL THEN 'product:' || oi.product_id ELSE 'name:' || fin_key(COALESCE(oi.product_name, '')) END AS item_key,
             COALESCE(oi.quantity, 0)::double precision AS qty, to_char(fin_ts(o.created_at, true), 'YYYY-MM-DD') AS day, o.warehouse
        FROM orders o JOIN order_items oi ON oi.order_id = o.id
       WHERE o.status <> 'Отменен'
    ) s
    WHERE s.day >= @rec_from AND s.day <= @rec_to
      ${withWarehouses ? "AND fin_key(s.warehouse) IN (SELECT fin_key(x) FROM unnest(@rec_wh::text[]) AS x)" : ""}
    GROUP BY s.item_key`
}

async function salesSource(orderMovements: number, db: PgDb): Promise<RecommendedSalesSource> {
  const column = await db.prepare("SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'warehouse'").get()
  let ordersWithWarehouse = 0
  if (column) {
    const row = await db.prepare("SELECT COUNT(*) AS n FROM orders WHERE COALESCE(warehouse, '') <> ''").get()
    ordersWithWarehouse = Number(row?.n) || 0
  }
  return { warehouseColumn: Boolean(column), ordersWithWarehouse, orderMovements }
}

/** Every listed row (items with sales), unsorted and unpaged. */
export async function recommendedRows(filters: RecommendedFilters, db: PgDb = getDb()): Promise<{ rows: RecommendedRow[]; totalSold: number; sales: RecommendedSalesSource }> {
  const params: Record<string, unknown> = { rec_from: filters.from, rec_to: filters.to }
  if (filters.warehouses.length) params.rec_wh = filters.warehouses
  const [saleRows, items] = await Promise.all([db.prepare(salesSql(filters.warehouses.length > 0)).all(params), getStockCatalog(db)])
  const sales = await salesSource(saleRows.reduce((sum, row) => sum + (Number(row.lines) || 0), 0), db)
  const catalog = new Map(items.map((item) => [item.key, item]))

  const needle = filters.search.toLowerCase()
  const matches = (key: string, item: StockCatalogItem | undefined) => {
    if (!item) return !(filters.organizations.length || filters.types.length || filters.subcategories.length || filters.brands.length) && (!needle || key.toLowerCase().includes(needle))
    if (filters.organizations.length && !filters.organizations.includes(item.organization)) return false
    if (filters.types.length && !filters.types.includes(item.type)) return false
    if (filters.subcategories.length && !filters.subcategories.includes(item.subcategory ?? "")) return false
    if (filters.brands.length && !filters.brands.includes(item.brand)) return false
    return true
  }
  const selling = saleRows.filter((row) => Number(row.sold) > 0 && matches(String(row.item_key), catalog.get(String(row.item_key))))
  if (!selling.length) return { rows: [], totalSold: 0, sales }

  // Available now in the chosen warehouses.
  const warehouses = filters.warehouses.length ? filters.warehouses : undefined
  const [balances, pending] = await Promise.all([getStockBalances({ warehouses }, db), getStockPending({ warehouses }, db)])
  const available = new Map<string, number>()
  for (const balance of balances) available.set(balance.key, (available.get(balance.key) ?? 0) + balance.qty - balance.defects)
  for (const entry of pending) available.set(entry.key, (available.get(entry.key) ?? 0) - entry.reserved)

  // Shares are computed over the listed (filtered) items, before the search.
  const numbers = recommendedNumbers(
    selling.map((row) => ({ key: String(row.item_key), sold: Number(row.sold) || 0, saleDays: Number(row.days) || 0, available: available.get(String(row.item_key)) ?? 0 })),
  )
  const totalSold = selling.reduce((sum, row) => sum + (Number(row.sold) || 0), 0)
  const orphans = await stockOrphanNames([...numbers.keys()].filter((key) => !catalog.has(key)), db)
  // Показать по типу ед.: Вес = × kg of a unit, Объем = × its «Объем», Блок = ÷ the units of its box (×1 without one).
  const factorOf = (item: StockCatalogItem | undefined) =>
    filters.unit === "weight" ? (item?.weight ?? 0) : filters.unit === "capacity" ? (item?.volume ?? 0) : filters.unit === "box" ? (item?.boxSize ? 1 / item.boxSize : 1) : 1
  const days = new Map(selling.map((row) => [String(row.item_key), Number(row.days) || 0]))
  const totalConverted = filters.unit === "measurement" ? 0 : [...numbers].reduce((sum, [key, values]) => sum + values.sold * factorOf(catalog.get(key)), 0)
  const rows: RecommendedRow[] = []
  for (const [key, values] of numbers) {
    const item = catalog.get(key)
    const name = item?.name ?? orphans.get(key)?.name ?? (key.startsWith("name:") ? key.slice(5) : key)
    if (needle && !name.toLowerCase().includes(needle) && !(item?.article ?? "").toLowerCase().includes(needle)) continue
    const weight = item?.weight ?? 0
    const unit = filters.unit === "weight" ? "кг" : filters.unit === "capacity" ? "м³" : filters.unit === "box" && item?.boxSize ? item.boxUnit || "блок" : (item?.unit ?? "")
    const converted = filters.unit === "measurement" ? values : convertRecommended(values, factorOf(item), days.get(key) ?? 0, totalConverted)
    rows.push({ ...converted, key, name, article: item?.article ?? "", unit, type: item?.type ?? "", brand: item?.brand ?? "", weight })
  }
  return { rows, totalSold, sales }
}

/** Linko's server order (Запас дней ascending, then the product id), which its page re-sorts stably by a header. */
function linkoOrder(a: RecommendedRow, b: RecommendedRow): number {
  const id = (row: RecommendedRow) => Number(/^(?:product|raw_material):(\d+)$/.exec(row.key)?.[1] ?? Number.MAX_SAFE_INTEGER)
  return a.remainDays - b.remainDays || id(a) - id(b) || a.name.localeCompare(b.name, "ru")
}

/** Linko's ordering names (its page writes ?ordering=totalAmount …) → the row fields. */
const LINKO_SORT_KEYS: Record<string, string> = { kgValue: "weight", totalAmount: "sold", totalBalance: "available", weekRecommendations: "week", monthRecommendations: "month" }

function compare(ordering: string) {
  const desc = ordering.startsWith("-")
  const raw = desc ? ordering.slice(1) : ordering
  const field = LINKO_SORT_KEYS[raw] ?? raw
  if (!field) return linkoOrder
  const byName = (a: RecommendedRow, b: RecommendedRow) => a.name.localeCompare(b.name, "ru") || a.key.localeCompare(b.key)
  if (field === "name" || !SORT_KEYS.has(field)) return (a: RecommendedRow, b: RecommendedRow) => (desc ? -byName(a, b) : byName(a, b))
  const pick = (row: RecommendedRow) => Number(row[field as keyof RecommendedRow]) || 0
  return (a: RecommendedRow, b: RecommendedRow) => (desc ? pick(b) - pick(a) : pick(a) - pick(b)) || linkoOrder(a, b)
}

export async function recommendedList(filters: RecommendedFilters, paging: { page: number; pageSize: number; ordering: string }, db: PgDb = getDb()): Promise<RecommendedListResult> {
  const { rows, totalSold, sales } = await recommendedRows(filters, db)
  rows.sort(compare(paging.ordering))
  const pageSize = paging.pageSize
  const lastPage = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1
  const page = Math.min(paging.page, lastPage)
  const results = pageSize ? rows.slice((page - 1) * pageSize, page * pageSize) : rows
  return { from: filters.from, to: filters.to, unit: filters.unit, count: rows.length, page, pageSize, totalSold, results, sales }
}

export function parseRecommendedPaging(params: URLSearchParams): { page: number; pageSize: number; ordering: string } {
  const page = parsePageParam(params.get("page"))
  const sizeRaw = params.get("pageSize")
  const size = sizeRaw === null || sizeRaw === "" ? 25 : Math.floor(Number(sizeRaw))
  return { page, pageSize: Number.isFinite(size) && size >= 0 ? Math.min(size, 5000) : 25, ordering: (params.get("ordering") ?? "").trim() }
}

/** "Скачать все" sheet: the table's columns. */
export function recommendedSheet(rows: RecommendedRow[], t: (text: string) => string): Array<Array<string | number>> {
  return [
    [t("Товар"), t("Вес одной ед."), t("Тип"), t("Бренд"), t("Продано"), `${t("Доля от продаж")} (%)`, t("Доступно"), t("Сред. дневные продажи"), t("Запас дней"), t("Рек. запас на 6 дней"), t("Рек. запас на 30 дней")],
    ...rows.map((row) => [row.name, row.weight, row.type, row.brand, row.sold, row.salePart, row.available, row.byDay, row.remainDays, row.week, row.month]),
  ]
}

/** Auth + parsing of the /api/stock/recommended routes. */
export async function recommendedRequest(url: string): Promise<{ filters: RecommendedFilters; params: URLSearchParams; error?: undefined } | { error: NextResponse }> {
  const user = await getCurrentUser()
  if (!user) return { error: notSignedInResponse() }
  const params = new URL(url).searchParams
  const parsed = parseRecommendedFilters(params)
  if (parsed.error !== undefined) {
    return { error: invalidFieldResponse(parsed.error, "YYYY-MM-DD") }
  }
  // Without a warehouse filter, the warehouses linked to the user's employee card (as Linko scopes the report).
  if (!parsed.filters.warehouses.length) parsed.filters.warehouses = await linkedWarehouseNames(user)
  return { filters: parsed.filters, params }
}
