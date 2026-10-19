import "server-only"

import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDb, type PgDb } from "@/lib/db"
import { normCurrency } from "@/lib/finance/currency"
import { loadCurrencyContext } from "@/lib/finance/context"
import { isIsoDay, monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { stockOrphanNames } from "@/lib/stock/level"
import { getStockBalances, getStockCatalog, stockMovementsSql } from "@/lib/stock/ledger"
import { STOCK_MOVE_KINDS, type StockBalance, type StockCatalogItem, type StockMoveKind } from "@/lib/stock/types"
import {
  MOVE_FIELDS,
  MOVE_GROUP_BY,
  MOVE_GROUP_TITLES,
  emptyMoveNumbers,
  moveColumns,
  shownMoveValue,
  type MoveField,
  type MoveGroupBy,
  type MoveMode,
  type MoveNumbers,
  type MovePresence,
} from "@/lib/stock-movement-columns"

// "Остаток на определенную дату" (demo api/v2/stats/stock/products + sum):
// the stock ledger (lib/stock stockMovementsSql) aggregated per item and
// warehouse over a period:
//   begin  = Σ movements before `from`
//   kind   = Σ movements of that kind within [from, to]
//   end    = begin + Σ kinds
// then grouped by item / brand / type / warehouse / branch.
// Modes: quantity; cost (begin/end valued like "Остаток" = getStockBalances
// value; movements at their document value, else qty × average cost at the
// end of the period); price (qty × the item's price in the chosen price list).

export type MoveFilters = {
  from: string
  to: string
  /** Warehouse names. */
  warehouses: string[]
  /** Branch names (warehouses.branch). */
  branches: string[]
  /** Item organization. */
  organizations: string[]
  /** Тип продукта (catalog type). */
  types: string[]
  /** Подкатегория (products.subcategory). */
  subcategories: string[]
  brands: string[]
  search: string
  groupBy: MoveGroupBy
  mode: MoveMode
  /** Price-list name (price mode). */
  priceList: string
  transaction: MovePresence
  balance: MovePresence
}

export type MoveRow = {
  /** Item key / warehouse / branch / brand / type ("" = not set). */
  key: string
  name: string
  article: string
  unit: string
  qty: MoveNumbers
  /** Cost / price-list value; null in quantity mode (or price mode without a list). */
  value: MoveNumbers | null
}

type ModeEcho = {
  from: string
  to: string
  mode: MoveMode
  groupBy: MoveGroupBy
  priceList: string
  needPriceList: boolean
  /** Currency code of the values: base currency (cost), the price list's (price), "" (quantity). */
  currency: string
}

export type MoveListResult = ModeEcho & { count: number; page: number; pageSize: number; results: MoveRow[] }
export type MoveSumResult = ModeEcho & { count: number; qty: MoveNumbers; value: MoveNumbers | null }

export type MoveItemDocument = { day: string; warehouse: string; kind: StockMoveKind; docType: string; docId: number; qty: number; value: number | null }
export type MoveItemDetail = ModeEcho & {
  item: { key: string; name: string; article: string; unit: string; type: string; brand: string }
  total: MoveRow
  warehouses: MoveRow[]
  documents: MoveItemDocument[]
  documentsTruncated: boolean
}

const GROUP_IDS = new Set(MOVE_GROUP_BY.map((item) => item.id))
const SORT_FIELDS = new Set<string>(MOVE_FIELDS)
const DOCUMENT_LIMIT = 500

// --- query parsing -----------------------------------------------------------------

function list(params: URLSearchParams, name: string): string[] {
  return [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))]
}

function presence(value: string | null): MovePresence {
  return value === "exist" || value === "not_exist" ? value : ""
}

/** from to warehouse* branch* organization* type* subcategory* brand* search groupBy mode priceList transaction balance. */
export function parseMoveFilters(params: URLSearchParams): { filters: MoveFilters; error?: undefined } | { filters?: undefined; error: string } {
  const today = todayIso()
  const fromRaw = params.get("from") ?? ""
  const toRaw = params.get("to") ?? ""
  if (fromRaw && !isIsoDay(fromRaw)) return { error: "from" }
  if (toRaw && !isIsoDay(toRaw)) return { error: "to" }
  let from = fromRaw || monthStartIso(today)
  let to = toRaw || monthEndIso(today)
  if (from > to) [from, to] = [to, from]
  const groupBy = (params.get("groupBy") ?? "product") as MoveGroupBy
  const modeRaw = params.get("mode") ?? "quantity"
  const mode: MoveMode = modeRaw === "cost" || modeRaw === "price" ? modeRaw : "quantity"
  return {
    filters: {
      from,
      to,
      warehouses: list(params, "warehouse"),
      branches: list(params, "branch"),
      organizations: list(params, "organization"),
      types: list(params, "type"),
      subcategories: list(params, "subcategory"),
      brands: list(params, "brand"),
      search: (params.get("search") ?? "").trim(),
      groupBy: GROUP_IDS.has(groupBy) ? groupBy : "product",
      // Demo: the price-list tab is hidden when grouping by warehouse / branch.
      mode: mode === "price" && (groupBy === "stock" || groupBy === "branch") ? "quantity" : mode,
      priceList: (params.get("priceList") ?? "").trim(),
      transaction: presence(params.get("transaction")),
      balance: presence(params.get("balance")),
    },
  }
}

export function parsePaging(params: URLSearchParams): { page: number; pageSize: number; ordering: string } {
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1))
  const sizeRaw = params.get("pageSize")
  const size = sizeRaw === null || sizeRaw === "" ? 25 : Math.floor(Number(sizeRaw))
  return { page, pageSize: Number.isFinite(size) && size >= 0 ? Math.min(size, 5000) : 25, ordering: (params.get("ordering") ?? "").trim() }
}

// --- helpers ----------------------------------------------------------------------

const round = (value: number) => {
  const rounded = Math.round(value * 1e6) / 1e6
  return Object.is(rounded, -0) ? 0 : rounded
}

function finish(numbers: MoveNumbers): MoveNumbers {
  numbers.other_in = numbers.inventory_in + numbers.manufacture_in + numbers.transfer_in + numbers.none_in
  numbers.other_out = numbers.inventory_out + numbers.manufacture_out + numbers.transfer_out + numbers.none_out
  for (const field of MOVE_FIELDS) numbers[field] = round(numbers[field])
  return numbers
}

function addInto(target: MoveNumbers, source: MoveNumbers) {
  for (const field of MOVE_FIELDS) target[field] += source[field]
}

function scaled(source: MoveNumbers, factor: number): MoveNumbers {
  const result = emptyMoveNumbers()
  for (const field of MOVE_FIELDS) result[field] = source[field] * factor
  return result
}

const cellKey = (itemKey: string, warehouseKey: string) => `${itemKey}\u0000${warehouseKey}`

/** JS twin of the SQL fin_key(): trimmed, single-spaced, lower-cased. */
export function finKey(value: string): string {
  return value.replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim().toLowerCase()
}

function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function nameOfKey(key: string, context: Context): string {
  return context.catalog.get(key)?.name ?? context.orphans.get(key) ?? (key.startsWith("name:") ? key.slice(5) : key)
}

/** Resolves the original spelling of the keys that are not in the catalog. */
async function resolveOrphans(keys: Iterable<string>, context: Context, db: PgDb) {
  const missing = [...new Set(keys)].filter((key) => !context.catalog.has(key) && !context.orphans.has(key))
  for (const [key, item] of await stockOrphanNames(missing, db)) context.orphans.set(key, item.name)
}

type Context = {
  catalog: Map<string, StockCatalogItem>
  /** fin_key(name) → the warehouses table's spelling and branch. */
  warehouses: Map<string, { name: string; branch: string }>
  /** Allowed warehouse names (null = all). */
  allowedWarehouses: string[] | null
  /** Display names of keys missing from the catalog (filled by resolveOrphans). */
  orphans: Map<string, string>
}

async function loadContext(filters: Pick<MoveFilters, "warehouses" | "branches">, db: PgDb): Promise<Context> {
  const [items, warehouseRows] = await Promise.all([getStockCatalog(db), db.prepare("SELECT name, COALESCE(branch, '') AS branch FROM warehouses ORDER BY id").all()])
  const catalog = new Map(items.map((item) => [item.key, item]))
  const warehouses = new Map<string, { name: string; branch: string }>()
  for (const row of warehouseRows) {
    const name = String(row.name ?? "").trim()
    const key = finKey(name)
    if (key && !warehouses.has(key)) warehouses.set(key, { name, branch: String(row.branch ?? "").trim() })
  }
  let allowedWarehouses: string[] | null = null
  if (filters.warehouses.length || filters.branches.length) {
    const names = filters.warehouses.length ? filters.warehouses : [...warehouses.values()].map((warehouse) => warehouse.name)
    allowedWarehouses = filters.branches.length ? names.filter((name) => filters.branches.includes(warehouses.get(finKey(name))?.branch ?? "")) : names
  }
  return { catalog, warehouses, allowedWarehouses, orphans: new Map() }
}

function itemMatches(key: string, filters: MoveFilters, context: Context): boolean {
  const item = context.catalog.get(key)
  const catalogFilter = filters.organizations.length || filters.types.length || filters.subcategories.length || filters.brands.length
  if (!item) {
    if (catalogFilter) return false
    return !filters.search || filters.groupBy !== "product" || nameOfKey(key, context).toLowerCase().includes(filters.search.toLowerCase())
  }
  if (filters.organizations.length && !filters.organizations.includes(item.organization)) return false
  if (filters.types.length && !filters.types.includes(item.type)) return false
  if (filters.subcategories.length && !filters.subcategories.includes(item.subcategory ?? "")) return false
  if (filters.brands.length && !filters.brands.includes(item.brand)) return false
  if (filters.search && filters.groupBy === "product") {
    const needle = filters.search.toLowerCase()
    if (!item.name.toLowerCase().includes(needle) && !item.article.toLowerCase().includes(needle)) return false
  }
  return true
}

type Cell = { itemKey: string; warehouseKey: string; warehouse: string; qty: MoveNumbers; value: MoveNumbers | null }

/** WHERE parts shared by the ledger queries: warehouses grouped by fin_key, rows without a warehouse skipped (as in getStockBalances). */
function ledgerWhere(context: Context, params: Record<string, unknown>): string[] {
  const where = ["fin_key(m.warehouse) <> ''"]
  if (context.allowedWarehouses) {
    where.push("fin_key(m.warehouse) IN (SELECT fin_key(x) FROM unnest(@rep_wh::text[]) AS x)")
    params.rep_wh = context.allowedWarehouses
  }
  return where
}

/** Ledger → one cell per (item, warehouse) with begin / kinds / end; `costs` = average unit cost at the end of the period. */
async function loadCells(
  filters: MoveFilters,
  context: Context,
  db: PgDb,
  itemKey?: string,
): Promise<{ cells: Cell[]; needPriceList: boolean; costs: Map<string, number> }> {
  const needPriceList = filters.mode === "price" && !filters.priceList
  const costs = new Map<string, number>()
  if (context.allowedWarehouses && !context.allowedWarehouses.length) return { cells: [], needPriceList, costs }
  const ledger = await stockMovementsSql({}, db)
  const params: Record<string, unknown> = { ...ledger.params, rep_from: filters.from, rep_to: filters.to }
  const where = [...ledgerWhere(context, params), "m.day <= @rep_to"]
  if (itemKey) {
    where.push("m.item_key = @rep_key")
    params.rep_key = itemKey
  }
  const rows = await db
    .prepare(
      `SELECT m.item_key, fin_key(m.warehouse) AS wk, MIN(m.warehouse) AS wh, m.kind, (m.day < @rep_from) AS is_before,
              SUM(m.qty) AS qty, SUM(m.value) AS value,
              SUM(CASE WHEN COALESCE(m.value, 0) = 0 THEN m.qty ELSE 0 END) AS unvalued
         FROM (${ledger.sql}) m
        WHERE ${where.join(" AND ")}
        GROUP BY 1, 2, 4, 5`,
    )
    .all(params)

  const cells = new Map<string, Cell & { kindValue: MoveNumbers; unvalued: MoveNumbers }>()
  for (const row of rows) {
    const key = String(row.item_key)
    if (!itemKey && !itemMatches(key, filters, context)) continue
    const warehouseKey = String(row.wk ?? "")
    const id = cellKey(key, warehouseKey)
    let cell = cells.get(id)
    if (!cell) {
      const warehouse = context.warehouses.get(warehouseKey)?.name ?? String(row.wh ?? "").trim()
      cell = { itemKey: key, warehouseKey, warehouse, qty: emptyMoveNumbers(), value: null, kindValue: emptyMoveNumbers(), unvalued: emptyMoveNumbers() }
      cells.set(id, cell)
    }
    const qty = Number(row.qty) || 0
    const kind = String(row.kind) as StockMoveKind
    if (row.is_before === true) {
      cell.qty.begin += qty
    } else if (STOCK_MOVE_KINDS.includes(kind)) {
      cell.qty[kind] += qty
      cell.kindValue[kind] += Number(row.value) || 0
      cell.unvalued[kind] += Number(row.unvalued) || 0
    }
  }

  // Cost mode: begin / end valued like "Остаток" (qty × average cost at that
  // moment); movements at their document value, else (transfers, lines without
  // a cost) qty × the average cost at the end of the period.
  let beginBalances = new Map<string, StockBalance>()
  let endBalances = new Map<string, StockBalance>()
  if (filters.mode === "cost" && cells.size) {
    const warehouses = context.allowedWarehouses ?? undefined
    const [begin, end] = await Promise.all([
      getStockBalances({ warehouses, date: previousDay(filters.from) }, db),
      getStockBalances({ warehouses, date: filters.to }, db),
    ])
    beginBalances = new Map(begin.map((balance) => [cellKey(balance.key, finKey(balance.warehouse)), balance]))
    endBalances = new Map(end.map((balance) => [cellKey(balance.key, finKey(balance.warehouse)), balance]))
    for (const balance of end) costs.set(balance.key, balance.cost)
  }

  const result: Cell[] = []
  for (const [id, cell] of cells) {
    cell.qty.end = cell.qty.begin + STOCK_MOVE_KINDS.reduce((sum, kind) => sum + cell.qty[kind], 0)
    finish(cell.qty)
    let value: MoveNumbers | null = null
    if (filters.mode === "cost") {
      const begin = beginBalances.get(id)
      const end = endBalances.get(id)
      const unitCost = costs.get(cell.itemKey) ?? context.catalog.get(cell.itemKey)?.fallbackCost ?? 0
      value = emptyMoveNumbers()
      value.begin = begin ? begin.value : cell.qty.begin * unitCost
      value.end = end ? end.value : cell.qty.end * unitCost
      for (const kind of STOCK_MOVE_KINDS) value[kind] = cell.kindValue[kind] + cell.unvalued[kind] * unitCost
      finish(value)
    } else if (filters.mode === "price" && !needPriceList) {
      value = finish(scaled(cell.qty, context.catalog.get(cell.itemKey)?.prices[filters.priceList] ?? 0))
    }
    result.push({ itemKey: cell.itemKey, warehouseKey: cell.warehouseKey, warehouse: cell.warehouse, qty: cell.qty, value })
  }
  return { cells: result, needPriceList, costs }
}

function groupOf(cell: Pick<Cell, "itemKey" | "warehouse" | "warehouseKey">, groupBy: MoveGroupBy, context: Context): string {
  const item = context.catalog.get(cell.itemKey)
  switch (groupBy) {
    case "stock":
      return cell.warehouse
    case "branch":
      return context.warehouses.get(cell.warehouseKey)?.branch ?? ""
    case "brand":
      return item?.brand ?? ""
    case "type":
      return item?.type ?? ""
    default:
      return cell.itemKey
  }
}

function blankRow(key: string, groupBy: MoveGroupBy, context: Context, withValue: boolean): MoveRow {
  const item = groupBy === "product" ? context.catalog.get(key) : undefined
  return {
    key,
    name: groupBy === "product" ? nameOfKey(key, context) : key,
    article: item?.article ?? "",
    unit: item?.unit ?? "",
    qty: emptyMoveNumbers(),
    value: withValue ? emptyMoveNumbers() : null,
  }
}

function presenceMatches(row: MoveRow, filters: MoveFilters): boolean {
  if (filters.transaction) {
    const moved = STOCK_MOVE_KINDS.some((kind) => row.qty[kind] !== 0)
    if (moved !== (filters.transaction === "exist")) return false
  }
  if (filters.balance) {
    const hasBalance = row.qty.begin !== 0 || row.qty.end !== 0
    if (hasBalance !== (filters.balance === "exist")) return false
  }
  return true
}

function compareRows(ordering: string) {
  const desc = ordering.startsWith("-")
  const raw = desc ? ordering.slice(1) : ordering
  const [field, part] = raw.split(".")
  const byName = (a: MoveRow, b: MoveRow) => a.name.localeCompare(b.name, "ru") || a.key.localeCompare(b.key)
  if (!SORT_FIELDS.has(field)) return (a: MoveRow, b: MoveRow) => (desc ? -byName(a, b) : byName(a, b))
  const pick = (row: MoveRow) => (part === "value" ? (row.value?.[field as MoveField] ?? 0) : row.qty[field as MoveField])
  return (a: MoveRow, b: MoveRow) => (desc ? pick(b) - pick(a) : pick(a) - pick(b)) || byName(a, b)
}

/** Every row of the report (filtered, sorted). */
export async function stockMovementRows(filters: MoveFilters, ordering = "", db: PgDb = getDb()): Promise<{ rows: MoveRow[]; needPriceList: boolean }> {
  const context = await loadContext(filters, db)
  const { cells, needPriceList } = await loadCells(filters, context, db)
  if (filters.groupBy === "product") await resolveOrphans(cells.map((cell) => cell.itemKey), context, db)
  const withValue = filters.mode === "cost" || (filters.mode === "price" && !needPriceList)
  const groups = new Map<string, MoveRow>()
  const ensure = (key: string) => {
    let row = groups.get(key)
    if (!row) {
      row = blankRow(key, filters.groupBy, context, withValue)
      groups.set(key, row)
    }
    return row
  }

  // Zero rows: every catalog item / warehouse / branch / brand / type in scope.
  const warehouseKeys = (context.allowedWarehouses ?? [...context.warehouses.values()].map((warehouse) => warehouse.name)).map(finKey).filter(Boolean)
  if (filters.groupBy === "stock") {
    for (const key of new Set(warehouseKeys)) ensure(context.warehouses.get(key)?.name ?? context.allowedWarehouses?.find((name) => finKey(name) === key) ?? key)
  } else if (filters.groupBy === "branch") {
    for (const key of new Set(warehouseKeys)) ensure(context.warehouses.get(key)?.branch ?? "")
  } else if (!context.allowedWarehouses || context.allowedWarehouses.length) {
    for (const key of context.catalog.keys()) {
      if (itemMatches(key, filters, context)) ensure(groupOf({ itemKey: key, warehouse: "", warehouseKey: "" }, filters.groupBy, context))
    }
  }

  for (const cell of cells) {
    const row = ensure(groupOf(cell, filters.groupBy, context))
    addInto(row.qty, cell.qty)
    if (row.value && cell.value) addInto(row.value, cell.value)
  }

  const needle = filters.search.toLowerCase()
  const rows = [...groups.values()]
    .map((row) => ({ ...row, qty: finish(row.qty), value: row.value ? finish(row.value) : null }))
    .filter((row) => presenceMatches(row, filters))
    .filter((row) => filters.groupBy === "product" || !needle || row.name.toLowerCase().includes(needle))
    .sort(compareRows(ordering || "name"))
  return { rows, needPriceList }
}

async function echo(filters: MoveFilters, needPriceList: boolean, db: PgDb): Promise<ModeEcho> {
  let currency = ""
  if (filters.mode !== "quantity") {
    const context = await loadCurrencyContext(db)
    currency = context.base
    if (filters.mode === "price" && filters.priceList) {
      const row = await db.prepare("SELECT currency FROM price_lists WHERE name = ? ORDER BY id LIMIT 1").get(filters.priceList)
      if (row?.currency) currency = normCurrency(String(row.currency))
    }
  }
  return { from: filters.from, to: filters.to, mode: filters.mode, groupBy: filters.groupBy, priceList: filters.priceList, needPriceList, currency }
}

export async function stockMovementList(filters: MoveFilters, paging: { page: number; pageSize: number; ordering: string }, db: PgDb = getDb()): Promise<MoveListResult> {
  const { rows, needPriceList } = await stockMovementRows(filters, paging.ordering, db)
  const pageSize = paging.pageSize
  const lastPage = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1
  const page = Math.min(paging.page, lastPage)
  const results = pageSize ? rows.slice((page - 1) * pageSize, page * pageSize) : rows
  return { ...(await echo(filters, needPriceList, db)), count: rows.length, page, pageSize, results }
}

export async function stockMovementSum(filters: MoveFilters, db: PgDb = getDb()): Promise<MoveSumResult> {
  const { rows, needPriceList } = await stockMovementRows(filters, "", db)
  const qty = emptyMoveNumbers()
  const withValue = filters.mode === "cost" || (filters.mode === "price" && !needPriceList)
  const value = withValue ? emptyMoveNumbers() : null
  for (const row of rows) {
    addInto(qty, row.qty)
    if (value && row.value) addInto(value, row.value)
  }
  return { ...(await echo(filters, needPriceList, db)), count: rows.length, qty: finish(qty), value: value ? finish(value) : null }
}

/** One item: per-warehouse rows, the total and the period's documents. */
export async function stockMovementItem(key: string, filters: MoveFilters, db: PgDb = getDb()): Promise<MoveItemDetail | null> {
  const context = await loadContext(filters, db)
  const item = context.catalog.get(key)
  if (!item && !key.startsWith("name:")) return null
  const itemFilters: MoveFilters = { ...filters, groupBy: "stock", search: "", organizations: [], types: [], subcategories: [], brands: [], transaction: "", balance: "" }
  const { cells, needPriceList, costs } = await loadCells(itemFilters, context, db, key)
  await resolveOrphans([key], context, db)
  const withValue = filters.mode === "cost" || (filters.mode === "price" && !needPriceList)
  const total: MoveRow = { key, name: nameOfKey(key, context), article: item?.article ?? "", unit: item?.unit ?? "", qty: emptyMoveNumbers(), value: withValue ? emptyMoveNumbers() : null }
  const warehouses = cells
    .map((cell) => {
      addInto(total.qty, cell.qty)
      if (total.value && cell.value) addInto(total.value, cell.value)
      return { key: cell.warehouse, name: cell.warehouse, article: "", unit: total.unit, qty: cell.qty, value: cell.value }
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
  finish(total.qty)
  if (total.value) finish(total.value)

  // Documents of the period (lines without a document value: qty × the average cost at the end of the period).
  const ledger = await stockMovementsSql({}, db)
  const params: Record<string, unknown> = { ...ledger.params, rep_key: key, rep_from: filters.from, rep_to: filters.to }
  const where = [...ledgerWhere(context, params), "m.item_key = @rep_key", "m.day >= @rep_from", "m.day <= @rep_to"]
  const docRows =
    context.allowedWarehouses && !context.allowedWarehouses.length
      ? []
      : await db
          .prepare(
            `SELECT m.day, fin_key(m.warehouse) AS wk, MIN(m.warehouse) AS wh, m.kind, m.doc_type, m.doc_id,
                    SUM(m.qty) AS qty, SUM(m.value) AS value,
                    SUM(CASE WHEN COALESCE(m.value, 0) = 0 THEN m.qty ELSE 0 END) AS unvalued
               FROM (${ledger.sql}) m
              WHERE ${where.join(" AND ")}
              GROUP BY 1, 2, 4, 5, 6
              ORDER BY 1 DESC, 5, 6 DESC
              LIMIT ${DOCUMENT_LIMIT + 1}`,
          )
          .all(params)
  const unitCost = costs.get(key) ?? item?.fallbackCost ?? 0
  const price = item?.prices[filters.priceList] ?? 0
  const documents: MoveItemDocument[] = docRows.slice(0, DOCUMENT_LIMIT).map((row) => {
    const qty = round(Number(row.qty) || 0)
    const warehouse = context.warehouses.get(String(row.wk ?? ""))?.name ?? String(row.wh ?? "").trim()
    let value: number | null = null
    if (filters.mode === "cost") value = round((Number(row.value) || 0) + (Number(row.unvalued) || 0) * unitCost)
    else if (withValue) value = round(qty * price)
    return { day: String(row.day ?? ""), warehouse, kind: String(row.kind) as StockMoveKind, docType: String(row.doc_type ?? ""), docId: Number(row.doc_id) || 0, qty, value }
  })
  return {
    ...(await echo(filters, needPriceList, db)),
    item: { key, name: total.name, article: total.article, unit: total.unit, type: item?.type ?? "", brand: item?.brand ?? "" },
    total,
    warehouses,
    documents,
    documentsTruncated: docRows.length > DOCUMENT_LIMIT,
  }
}

// --- Excel ("Скачать" / "Скачать упрощенный список") --------------------------------

export type MoveSheetCell = string | number

/** Sheet rows of the report: "full" = the table's columns (Кол-во + Стоимость in
 * cost / price mode), "simple" = begin / Приход / Расход / end quantities. */
export function stockMovementSheet(rows: MoveRow[], filters: MoveFilters, options: { variant: "full" | "simple"; showOthers: boolean; withValue: boolean }, t: (text: string) => string): MoveSheetCell[][] {
  const productColumns = filters.groupBy === "product"
  const lead = productColumns ? [t(MOVE_GROUP_TITLES.product), t("Артикул"), t("Ед. изм.")] : [t(MOVE_GROUP_TITLES[filters.groupBy])]
  const leadOf = (row: MoveRow) => (productColumns ? [row.name, row.article, row.unit] : [row.name || t("Не указано")])
  const totalLead = [t("Итого"), ...lead.slice(1).map(() => "")]
  const total = emptyMoveNumbers()
  const totalValue = emptyMoveNumbers()
  for (const row of rows) {
    addInto(total, row.qty)
    if (row.value) addInto(totalValue, row.value)
  }
  finish(total)
  finish(totalValue)

  if (options.variant === "simple") {
    const income = (n: MoveNumbers) => round(n.supply + n.return + n.other_in)
    const outcome = (n: MoveNumbers) => round(-(n.supply_return + n.order + n.writeoff + n.other_out))
    const line = (n: MoveNumbers) => [n.begin, income(n), outcome(n), n.end]
    return [
      [...lead, t("Остаток на начало периода"), t("Приход"), t("Расход"), t("Остаток на конец")],
      ...rows.map((row) => [...leadOf(row), ...line(row.qty)]),
      [...totalLead, ...line(total)],
    ]
  }

  const columns = moveColumns(options.showOthers)
  const valueLabel = filters.mode === "price" ? t("Цена") : t("Стоимость")
  const cells = (qty: MoveNumbers, value: MoveNumbers | null) =>
    columns.flatMap((column) => (options.withValue ? [shownMoveValue(column, qty[column.field]), shownMoveValue(column, value?.[column.field] ?? 0)] : [shownMoveValue(column, qty[column.field])]))
  const header = [...lead, ...columns.flatMap((column) => (options.withValue ? [t(column.label), ""] : [t(column.label)]))]
  const subHeader = [...lead.map(() => ""), ...columns.flatMap(() => (options.withValue ? [t("Кол-во"), valueLabel] : [t("Кол-во")]))]
  return [header, subHeader, ...rows.map((row) => [...leadOf(row), ...cells(row.qty, row.value)]), [...totalLead, ...cells(total, options.withValue ? totalValue : null)]]
}

// --- route helpers ------------------------------------------------------------------

/** Auth (any signed-in user) + filter parsing of the /api/stock/movement routes. */
export async function movementRequest(url: string): Promise<{ filters: MoveFilters; params: URLSearchParams; error?: undefined } | { error: NextResponse }> {
  const user = await getCurrentUser()
  if (!user) return { error: NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 }) }
  const params = new URL(url).searchParams
  const parsed = parseMoveFilters(params)
  if (parsed.error !== undefined) {
    return { error: NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: { fieldErrors: { [parsed.error]: ["YYYY-MM-DD"] } } }, { status: 400 }) }
  }
  return { filters: parsed.filters, params }
}

/** 500 with the message (e.g. the stock core is not ready yet). */
export function movementFailure(error: unknown): NextResponse {
  console.error("stock movement report:", error)
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
}
