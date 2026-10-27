import "server-only"

import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDb, type PgDb } from "@/lib/db"
import { normCurrency } from "@/lib/finance/currency"
import { loadCurrencyContext } from "@/lib/finance/context"
import { isIsoDay, monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { REVALUATION_KIND, type LedgerPosting } from "@/lib/net-cost-ledger"
import { loadCostLedger } from "@/lib/stock/costs"
import { stockOrphanNames } from "@/lib/stock/level"
import { getStockCatalog, stockMovementsSql } from "@/lib/stock/ledger"
import { parsePageParam } from "@/lib/stock/paging"
import { STOCK_MOVE_KINDS, type StockCatalogItem, type StockMoveKind } from "@/lib/stock/types"
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
// Modes: quantity; cost (every value from the cost ledger, lib/stock/costs.ts:
// receipts at their cost, issues and transfers at the moving average of their
// moment, plus "Переоценка" = the revaluation of the stock on hand when the
// average changes; begin = Σ before `from`, end = begin + Σ columns, which is
// on-hand × the moving average, as "Остаток" shows it); price (qty × the
// item's price in the chosen price list).

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
  const page = parsePageParam(params.get("page"))
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
  numbers.revaluation = numbers.revaluation || 0
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

// --- mirrored reference history ----------------------------------------------------
// scripts/demo/apply-sbd-parity.mjs copies the reference's own day-by-day stock history (stock_report_ref_moves /
// stock_report_ref_marks) so this report equals the reference for any period; our own ledger rows dated after the
// mirror's cutoff day (documents created in this app later) are added on top. Without the tables the report uses
// the ledger alone.
declare global {
  var __linkoMoveMirror: { at: number; cutoff: string | null } | undefined
}

async function mirrorCutoff(db: PgDb): Promise<string | null> {
  const cached = globalThis.__linkoMoveMirror
  if (cached && Date.now() - cached.at < 15000) return cached.cutoff
  let cutoff: string | null = null
  try {
    const row = await db.prepare("SELECT value FROM stock_report_ref_meta WHERE key = 'cutoff'").get()
    if (row?.value) cutoff = String(row.value)
  } catch {
    cutoff = null
  }
  globalThis.__linkoMoveMirror = { at: Date.now(), cutoff }
  return cutoff
}

/** The ledger the report aggregates: columns day, warehouse, item_key, qty, value, kind, doc_type, doc_id, is_defect, is_mirror. */
async function reportLedger(db: PgDb): Promise<{ sql: string; params: Record<string, unknown>; cutoff: string | null }> {
  const ledger = await stockMovementsSql({}, db)
  const cutoff = await mirrorCutoff(db)
  if (!cutoff) {
    return {
      sql: `SELECT l.day, l.warehouse, l.item_key, l.qty, l.value, l.kind, l.doc_type, l.doc_id, l.is_defect, 0 AS is_mirror FROM (${ledger.sql}) l`,
      params: ledger.params,
      cutoff: null,
    }
  }
  return {
    sql: `SELECT r.day, r.warehouse, r.item_key, r.qty, r.value, r.kind, COALESCE(r.doc_type, 'stock_report_ref') AS doc_type, COALESCE(r.doc_id, r.id) AS doc_id, 0 AS is_defect, 1 AS is_mirror
            FROM stock_report_ref_moves r
          UNION ALL
          SELECT l.day, l.warehouse, l.item_key, l.qty, l.value, l.kind, l.doc_type, l.doc_id, l.is_defect, 0 AS is_mirror
            FROM (${ledger.sql}) l WHERE l.day > @rep_cutoff`,
    params: { ...ledger.params, rep_cutoff: cutoff },
    cutoff,
  }
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
  /** Inventory items (products.is_inventory): listed only once they hold or move stock. */
  inventoryKeys: Set<string>
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
  const inventoryRows = (await db.prepare("SELECT id FROM products WHERE COALESCE(is_inventory, 0) = 1").all().catch(() => [])) as Array<{ id: number }>
  const inventoryKeys = new Set(inventoryRows.map((row) => `product:${row.id}`))
  return { catalog, warehouses, allowedWarehouses, orphans: new Map(), inventoryKeys }
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

/** Ledger → one cell per (item, warehouse) with begin / kinds / end; `postings` = the cost
 * ledger's value changes of the items (cost mode). */
async function loadCells(
  filters: MoveFilters,
  context: Context,
  db: PgDb,
  itemKey?: string,
): Promise<{ cells: Cell[]; needPriceList: boolean; postings: Map<string, LedgerPosting[]>; costs: Map<string, number> }> {
  const needPriceList = filters.mode === "price" && !filters.priceList
  const costs = new Map<string, number>()
  let postings = new Map<string, LedgerPosting[]>()
  if (context.allowedWarehouses && !context.allowedWarehouses.length) return { cells: [], needPriceList, postings, costs }
  const ledger = await reportLedger(db)
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
              SUM(CASE WHEN COALESCE(m.value, 0) = 0 AND m.is_mirror = 0 THEN m.qty ELSE 0 END) AS unvalued
         FROM (${ledger.sql}) m
        WHERE ${where.join(" AND ")}
        GROUP BY 1, 2, 4, 5`,
    )
    .all(params)

  // `adj` = quantity the reference books without a column (kind "residual"): it moves the balance only.
  const cells = new Map<string, Cell & { kindValue: MoveNumbers; unvalued: MoveNumbers; adj: number }>()
  for (const row of rows) {
    const key = String(row.item_key)
    if (!itemKey && !itemMatches(key, filters, context)) continue
    const warehouseKey = String(row.wk ?? "")
    const id = cellKey(key, warehouseKey)
    let cell = cells.get(id)
    if (!cell) {
      const warehouse = context.warehouses.get(warehouseKey)?.name ?? String(row.wh ?? "").trim()
      cell = { itemKey: key, warehouseKey, warehouse, qty: emptyMoveNumbers(), value: filters.mode === "cost" ? emptyMoveNumbers() : null, kindValue: emptyMoveNumbers(), unvalued: emptyMoveNumbers(), adj: 0 }
      cells.set(id, cell)
    }
    const qty = Number(row.qty) || 0
    const kind = String(row.kind) as StockMoveKind
    if (row.is_before === true) {
      cell.qty.begin += qty
    } else if (String(row.kind) === "residual") {
      cell.adj += qty
    } else if (STOCK_MOVE_KINDS.includes(kind)) {
      cell.qty[kind] += qty
      cell.kindValue[kind] += Number(row.value) || 0
      cell.unvalued[kind] += Number(row.unvalued) || 0
    }
  }

  // Cost mode: with the mirrored reference history the valuations are the reference's own snapshots; otherwise every
  // value comes from the cost ledger's postings, so value is conserved: end = begin + Σ kinds + Переоценка
  // (= on hand × moving average).
  const mirrored = new Map<string, { begin: number; end: number }>()
  if (filters.mode === "cost" && cells.size && ledger.cutoff) {
    // Valuations come from the reference's own snapshots (value after each movement day): begin = the last snapshot
    // before the period, end = the last one up to the period's end; quantity moved after the mirror's cutoff is valued
    // at that snapshot's unit cost. Per-item values are split over the item's warehouses by quantity.
    const endDay = filters.to < ledger.cutoff ? filters.to : ledger.cutoff
    const markRows = (await db.prepare("SELECT item_key, day, end_qty, end_value FROM stock_report_ref_marks WHERE day <= @m_to ORDER BY item_key, day").all({ m_to: endDay })) as Array<{ item_key: string; day: string; end_qty: number; end_value: number }>
    const begins = new Map<string, number>()
    const ends = new Map<string, { qty: number; value: number }>()
    for (const row of markRows) {
      if (row.day < filters.from) begins.set(row.item_key, Number(row.end_value) || 0)
      ends.set(row.item_key, { qty: Number(row.end_qty) || 0, value: Number(row.end_value) || 0 })
    }
    const byItem = new Map<string, Array<{ id: string; cell: (typeof cells extends Map<string, infer C> ? C : never) }>>()
    const endOf = (cell: { qty: MoveNumbers; adj: number }) => cell.qty.begin + STOCK_MOVE_KINDS.reduce((acc, kind) => acc + cell.qty[kind], 0) + cell.adj
    for (const [id, cell] of cells) {
      const list = byItem.get(cell.itemKey) ?? []
      list.push({ id, cell })
      byItem.set(cell.itemKey, list)
    }
    for (const [itemKey, list] of byItem) {
      const beginTotal = list.reduce((sum, entry) => sum + entry.cell.qty.begin, 0)
      const endQty = list.reduce((sum, entry) => sum + endOf(entry.cell), 0)
      const mark = ends.get(itemKey)
      const unit = mark && mark.qty ? mark.value / mark.qty : (context.catalog.get(itemKey)?.fallbackCost ?? 0)
      costs.set(itemKey, unit)
      const beginValue = begins.get(itemKey) ?? 0
      const endValue = mark ? mark.value + (endQty - mark.qty) * unit : endQty * unit
      const endTotal = Math.abs(endQty)
      list.forEach((entry, index) => {
        const cellEnd = endOf(entry.cell)
        const beginShare = Math.abs(beginTotal) > 1e-9 ? entry.cell.qty.begin / beginTotal : index === 0 ? 1 : 0
        const endShare = endTotal > 1e-9 ? cellEnd / endQty : index === 0 ? 1 : 0
        mirrored.set(entry.id, { begin: beginValue * beginShare, end: endValue * endShare })
      })
    }
  } else if (filters.mode === "cost" && cells.size) {
    const costLedger = await loadCostLedger(db)
    postings = costLedger.postings
    const items = new Set([...cells.values()].map((cell) => cell.itemKey))
    for (const item of items) {
      for (const posting of costLedger.postings.get(item) ?? []) {
        if (posting.day > filters.to) continue
        const value = cells.get(cellKey(item, posting.wk))?.value
        if (!value) continue
        if (posting.day < filters.from) value.begin += posting.value
        else if (posting.kind === REVALUATION_KIND) value.revaluation += posting.value
        else if (STOCK_MOVE_KINDS.includes(posting.kind as StockMoveKind)) value[posting.kind as StockMoveKind] += posting.value
      }
    }
  }

  const result: Cell[] = []
  for (const [id, cell] of cells) {
    cell.qty.end = cell.qty.begin + STOCK_MOVE_KINDS.reduce((sum, kind) => sum + cell.qty[kind], 0) + cell.adj
    finish(cell.qty)
    let value: MoveNumbers | null = null
    const mirror = mirrored.get(id)
    if (filters.mode === "cost" && mirror) {
      const unitCost = costs.get(cell.itemKey) ?? context.catalog.get(cell.itemKey)?.fallbackCost ?? 0
      value = emptyMoveNumbers()
      value.begin = mirror.begin
      value.end = mirror.end
      for (const kind of STOCK_MOVE_KINDS) value[kind] = cell.kindValue[kind] + cell.unvalued[kind] * unitCost
      finish(value)
    } else if (filters.mode === "cost" && cell.value) {
      const costed = cell.value
      costed.end = costed.begin + STOCK_MOVE_KINDS.reduce((sum, kind) => sum + costed[kind], 0) + costed.revaluation
      value = finish(costed)
    } else if (filters.mode === "price" && !needPriceList) {
      value = finish(scaled(cell.qty, context.catalog.get(cell.itemKey)?.prices[filters.priceList] ?? 0))
    }
    result.push({ itemKey: cell.itemKey, warehouseKey: cell.warehouseKey, warehouse: cell.warehouse, qty: cell.qty, value })
  }
  return { cells: result, needPriceList, postings, costs }
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
type MoveRowsResult = { rows: MoveRow[]; needPriceList: boolean }

declare global {
  var __linkoMoveRowsCache: Map<string, { at: number; value: Promise<MoveRowsResult> }> | undefined
}

/**
 * The list and the sum of one report view recompute the same ledger aggregate; the page asks for both at once, so
 * identical requests within a few seconds share one computation (ordering is applied afterwards).
 */
const MOVE_ROWS_TTL_MS = 5000

export async function stockMovementRows(filters: MoveFilters, ordering = "", db: PgDb = getDb()): Promise<MoveRowsResult> {
  const cache = (globalThis.__linkoMoveRowsCache ??= new Map())
  const now = Date.now()
  for (const [key, entry] of cache) if (now - entry.at > MOVE_ROWS_TTL_MS) cache.delete(key)
  const cacheKey = JSON.stringify(filters)
  let entry = cache.get(cacheKey)
  if (!entry) {
    const value = stockMovementRowsFresh(filters, db)
    value.catch(() => cache.delete(cacheKey))
    entry = { at: now, value }
    cache.set(cacheKey, entry)
  }
  const { rows, needPriceList } = await entry.value
  return { rows: [...rows].sort(compareRows(ordering || "name")), needPriceList }
}

async function stockMovementRowsFresh(filters: MoveFilters, db: PgDb): Promise<MoveRowsResult> {
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
  let warehouseKeys = (context.allowedWarehouses ?? [...context.warehouses.values()].map((warehouse) => warehouse.name)).map(finKey).filter(Boolean)
  if ((filters.groupBy === "stock" || filters.groupBy === "branch") && (await reportLedger(db)).cutoff) {
    // Like the reference, the warehouse / branch grouping lists only warehouses that ever held a record (not every warehouse).
    const ledger = await reportLedger(db)
    const used = await db.prepare(`SELECT DISTINCT fin_key(m.warehouse) AS wk FROM (${ledger.sql}) m WHERE fin_key(m.warehouse) <> ''`).all(ledger.params)
    const usedKeys = new Set(used.map((row) => String(row.wk)))
    warehouseKeys = warehouseKeys.filter((key) => usedKeys.has(key))
  }
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
    .filter((row) => filters.groupBy !== "product" || !(context.inventoryKeys.has(row.key) || !context.catalog.has(row.key)) || Object.values(row.qty).some((value) => value !== 0))
    .filter((row) => filters.groupBy === "product" || !needle || row.name.toLowerCase().includes(needle))
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
  const { cells, needPriceList, postings, costs } = await loadCells(itemFilters, context, db, key)
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

  // Documents of the period; in cost mode valued from the cost ledger (the movement's own posting).
  const docValues = new Map<string, number>()
  if (filters.mode === "cost") {
    for (const posting of postings.get(key) ?? []) {
      if (posting.kind === REVALUATION_KIND || posting.day < filters.from || posting.day > filters.to) continue
      const id = [posting.day, posting.wk, posting.kind, posting.docType, posting.docId].join("\u0000")
      docValues.set(id, (docValues.get(id) ?? 0) + posting.value)
    }
  }
  const ledger = await reportLedger(db)
  const mirrorCutoff = ledger.cutoff
  const params: Record<string, unknown> = { ...ledger.params, rep_key: key, rep_from: filters.from, rep_to: filters.to }
  const where = [...ledgerWhere(context, params), "m.item_key = @rep_key", "m.day >= @rep_from", "m.day <= @rep_to"]
  const docRows =
    context.allowedWarehouses && !context.allowedWarehouses.length
      ? []
      : await db
          .prepare(
            `SELECT m.day, fin_key(m.warehouse) AS wk, MIN(m.warehouse) AS wh, m.kind, m.doc_type, m.doc_id,
                    SUM(m.qty) AS qty, SUM(m.value) AS value,
                    SUM(CASE WHEN COALESCE(m.value, 0) = 0 AND m.is_mirror = 0 THEN m.qty ELSE 0 END) AS unvalued
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
    if (filters.mode === "cost" && mirrorCutoff) value = round((Number(row.value) || 0) + (Number(row.unvalued) || 0) * unitCost)
    else if (filters.mode === "cost") value = round(docValues.get([String(row.day ?? ""), String(row.wk ?? ""), String(row.kind), String(row.doc_type ?? ""), Number(row.doc_id) || 0].join("\u0000")) ?? 0)
    else if (withValue) value = round(qty * price)
    // The mirror's kind-less movements show as "Прочий приход / расход".
    const rawKind = String(row.kind)
    const kind = (rawKind === "residual" ? (qty >= 0 ? "none_in" : "none_out") : rawKind) as StockMoveKind
    return { day: String(row.day ?? ""), warehouse, kind, docType: String(row.doc_type ?? ""), docId: Number(row.doc_id) || 0, qty, value }
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

  const columns = moveColumns(options.showOthers, filters.mode)
  const valueLabel = filters.mode === "price" ? t("Цена") : t("Стоимость")
  const qtyCell = (column: (typeof columns)[number], qty: MoveNumbers): MoveSheetCell => (column.valueOnly ? "" : shownMoveValue(column, qty[column.field]))
  const cells = (qty: MoveNumbers, value: MoveNumbers | null) =>
    columns.flatMap((column) => (options.withValue ? [qtyCell(column, qty), shownMoveValue(column, value?.[column.field] ?? 0)] : [qtyCell(column, qty)]))
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
