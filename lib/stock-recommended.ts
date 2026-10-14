import "server-only"

import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDb, type PgDb } from "@/lib/db"
import { isIsoDay, todayIso } from "@/lib/finance/dates"
import { stockOrphanNames } from "@/lib/stock/level"
import { getStockBalances, getStockCatalog, getStockPending, stockMovementsSql } from "@/lib/stock/ledger"
import type { StockCatalogItem } from "@/lib/stock/types"
import { convertRecommended, defaultRecommendedPeriod, parseMeasure, recommendedNumbers, type RecommendedNumbers } from "@/lib/stock-recommended-calc"

// "Рекомендованный запас" (demo #/recommended-stock, API stock/recommended_balances):
// per item with sales in the period —
//   sold        = −Σ `order` movements of the stock ledger within [from, to]
//   available   = on hand now − defects − reserved (getStockBalances / getStockPending)
//   by_day, remain_days, 6- / 30-day recommendations, share of sales: see
//   lib/stock-recommended-calc.ts.
// Sales come from orders shipped from a warehouse; until the orders module
// records a warehouse the list is empty (`sales` explains why).

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
  const ledger = await stockMovementsSql({}, db)
  const where = ["m.kind = 'order'", "m.day >= @rec_from", "m.day <= @rec_to"]
  const params: Record<string, unknown> = { ...ledger.params, rec_from: filters.from, rec_to: filters.to }
  if (filters.warehouses.length) {
    where.push("fin_key(m.warehouse) IN (SELECT fin_key(x) FROM unnest(@rec_wh::text[]) AS x)")
    params.rec_wh = filters.warehouses
  }
  const [saleRows, items, measureRows] = await Promise.all([
    db
      .prepare(
        `SELECT m.item_key, -SUM(m.qty) AS sold, COUNT(DISTINCT m.day) AS days, COUNT(*) AS lines
           FROM (${ledger.sql}) m
          WHERE ${where.join(" AND ")}
          GROUP BY m.item_key`,
      )
      .all(params),
    getStockCatalog(db),
    db
      .prepare(
        `SELECT 'product:' || id AS key, COALESCE(volume, '') AS volume FROM products
         UNION ALL
         SELECT 'raw_material:' || id, COALESCE(volume, '') FROM raw_materials`,
      )
      .all(),
  ])
  const sales = await salesSource(saleRows.reduce((sum, row) => sum + (Number(row.lines) || 0), 0), db)
  const catalog = new Map(items.map((item) => [item.key, item]))
  const volumes = new Map(measureRows.map((row) => [String(row.key), parseMeasure(row.volume)]))

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
  const rows: RecommendedRow[] = []
  for (const [key, values] of numbers) {
    const item = catalog.get(key)
    const name = item?.name ?? orphans.get(key)?.name ?? (key.startsWith("name:") ? key.slice(5) : key)
    if (needle && !name.toLowerCase().includes(needle) && !(item?.article ?? "").toLowerCase().includes(needle)) continue
    const weight = item?.weight ?? 0
    const factor = filters.unit === "weight" ? weight : filters.unit === "capacity" ? (volumes.get(key) ?? 0) : 1
    const unit = filters.unit === "weight" ? "кг" : filters.unit === "capacity" ? "м³" : (item?.unit ?? "")
    rows.push({ ...convertRecommended(values, factor), key, name, article: item?.article ?? "", unit, type: item?.type ?? "", brand: item?.brand ?? "", weight })
  }
  return { rows, totalSold, sales }
}

function compare(ordering: string) {
  const desc = ordering.startsWith("-")
  const field = desc ? ordering.slice(1) : ordering
  const byName = (a: RecommendedRow, b: RecommendedRow) => a.name.localeCompare(b.name, "ru") || a.key.localeCompare(b.key)
  if (field === "name" || !SORT_KEYS.has(field)) return (a: RecommendedRow, b: RecommendedRow) => (desc ? -byName(a, b) : byName(a, b))
  const pick = (row: RecommendedRow) => Number(row[field as keyof RecommendedRow]) || 0
  return (a: RecommendedRow, b: RecommendedRow) => (desc ? pick(b) - pick(a) : pick(a) - pick(b)) || byName(a, b)
}

export async function recommendedList(filters: RecommendedFilters, paging: { page: number; pageSize: number; ordering: string }, db: PgDb = getDb()): Promise<RecommendedListResult> {
  const { rows, totalSold, sales } = await recommendedRows(filters, db)
  rows.sort(compare(paging.ordering || "-sold"))
  const pageSize = paging.pageSize
  const lastPage = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1
  const page = Math.min(paging.page, lastPage)
  const results = pageSize ? rows.slice((page - 1) * pageSize, page * pageSize) : rows
  return { from: filters.from, to: filters.to, unit: filters.unit, count: rows.length, page, pageSize, totalSold, results, sales }
}

export function parseRecommendedPaging(params: URLSearchParams): { page: number; pageSize: number; ordering: string } {
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1))
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
  if (!user) return { error: NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 }) }
  const params = new URL(url).searchParams
  const parsed = parseRecommendedFilters(params)
  if (parsed.error !== undefined) {
    return { error: NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: { fieldErrors: { [parsed.error]: ["YYYY-MM-DD"] } } }, { status: 400 }) }
  }
  return { filters: parsed.filters, params }
}
