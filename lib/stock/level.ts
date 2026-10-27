import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { unitWeightKg } from "@/lib/internal-transfers-types"
import { loadCurrencyContext } from "@/lib/finance/context"
import { normCurrency } from "@/lib/finance/currency"
import { nameKey, placeName } from "@/lib/finance/entities"
import { computeStockBalances, computeStockPending, movementsQuery, type StockBalanceRow } from "@/lib/stock/balances"
import { loadStockCatalog } from "@/lib/stock/catalog"
import { getWarehouseItemCosts } from "@/lib/stock/costs"
import { stockTables, type StockTables } from "@/lib/stock/schema"
import { jsonLines } from "@/lib/stock/sources"
import type {
  StockItemDetail,
  StockLevelList,
  StockLevelQty,
  StockLevelQuery,
  StockLevelRow,
  StockLevelStock,
  StockLevelSum,
  StockReceipt,
} from "@/lib/stock/level-types"
import type { StockCatalogItem, StockPending } from "@/lib/stock/types"

// "Остаток" (demo #/statistics/remainder): current balance of EVERY catalog
// item (zero rows included unless "Только продукты в наличии"), plus items
// with stock that no longer / never matched the catalog. Reserved / В пути
// come from getStockPending; values use the cost of goods (СЕБЕСТОИМОСТЬ: the
// moving average of lib/stock/costs.ts, per warehouse when a warehouse is its
// own cost scope; Брак carries no value) or the selected price list (ПРАЙС ЛИСТ).
// The cost column of a row is the item's "Общий" cost.

const RECEIPT_KINDS = ["supply", "manufacture_in", "transfer_in", "inventory_in", "none_in", "return"]

type Context = {
  catalog: StockCatalogItem[]
  /** Cost of goods per item key (lib/stock/costs.ts), today. */
  costs: Map<string, number>
  /** Cost of an item in a warehouse (its own cost scope's when it has one), today. */
  costIn: (key: string, warehouse: string) => number | undefined
  balances: StockBalanceRow[]
  pending: StockPending[]
  /** fin_key(warehouse) → branch. */
  branchOf: Map<string, string>
  baseCurrency: string
  priceListCurrency: Map<string, string>
  tables: StockTables
}

const round = (value: number, digits = 6) => {
  const factor = 10 ** digits
  const result = Math.round((Number(value) || 0) * factor) / factor
  return Object.is(result, -0) ? 0 : result
}

async function loadContext(db: PgDb): Promise<Context> {
  const tables = await stockTables(db)
  const [catalog, itemCosts] = await Promise.all([loadStockCatalog(db, tables), getWarehouseItemCosts({}, db)])
  const { costs, byWarehouse, costOf: costIn } = itemCosts
  const [balances, pending, cc] = await Promise.all([computeStockBalances({}, db, catalog, costs, byWarehouse), computeStockPending({}, db), loadCurrencyContext(db)])
  const branchOf = new Map<string, string>()
  if (tables.has("warehouses")) {
    const rows = (await db.prepare("SELECT name, branch FROM warehouses ORDER BY id").all()) as Array<{ name: string; branch: string | null }>
    for (const row of rows) if (!branchOf.has(nameKey(row.name))) branchOf.set(nameKey(row.name), placeName(row.branch))
  }
  const priceListCurrency = new Map<string, string>()
  const priceLists = (await db.prepare("SELECT to_regclass('price_lists') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (priceLists?.ok) {
    const rows = (await db.prepare("SELECT name, currency FROM price_lists ORDER BY id").all()) as Array<{ name: string; currency: string | null }>
    for (const row of rows) if (row.name && !priceListCurrency.has(nameKey(row.name)) && row.currency) priceListCurrency.set(nameKey(row.name), normCurrency(row.currency, cc.base))
  }
  return { catalog, costs, costIn, balances, pending, branchOf, baseCurrency: cc.base, priceListCurrency, tables }
}

/** Original spelling (and unit) of item keys that are not in the catalog, for
 * the other stock reports ("name:<key>" keys are lower-cased). */
export async function stockOrphanNames(keys: string[], db: PgDb = getDb()): Promise<Map<string, { name: string; unit: string }>> {
  return keys.length ? orphanItems(keys, db, await stockTables(db)) : new Map()
}

/** Display names of balance keys that are not in the catalog (deleted
 * products, document names that match nothing). */
async function orphanItems(keys: string[], db: PgDb, t: StockTables): Promise<Map<string, { name: string; unit: string }>> {
  const result = new Map<string, { name: string; unit: string }>()
  const ids = (kind: string) => keys.filter((key) => key.startsWith(`${kind}:`)).map((key) => Number(key.slice(kind.length + 1))).filter(Number.isInteger)
  for (const [kind, table] of [["product", "products"], ["raw_material", "raw_materials"]] as const) {
    const list = ids(kind)
    if (!list.length || !t.has(table)) continue
    const rows = (await db.prepare(`SELECT id, name, unit FROM ${table} WHERE id = ANY(@stk_ids::int[])`).all({ stk_ids: list })) as Array<{ id: number; name: string; unit: string }>
    for (const row of rows) result.set(`${kind}:${row.id}`, { name: row.name, unit: row.unit ?? "" })
  }
  const names = keys.filter((key) => key.startsWith("name:")).map((key) => key.slice(5))
  if (names.length) {
    const parts: string[] = []
    const lines = (table: string, alias: string) => `SELECT l.j ->> 'product' AS n FROM ${table} ${alias} CROSS JOIN LATERAL jsonb_array_elements(${jsonLines(`${alias}.items`)}) AS l(j)`
    if (t.has("supplier_incomings")) parts.push(lines("supplier_incomings", "d"))
    if (t.has("supplier_returns")) parts.push(lines("supplier_returns", "d"))
    if (t.has("write_offs")) parts.push(lines("write_offs", "d"))
    if (t.has("internal_transfers")) parts.push(lines("internal_transfers", "d"))
    if (t.has("production_movements")) parts.push("SELECT item_name FROM production_movements")
    if (t.col("order_items", "product_name")) parts.push("SELECT product_name FROM order_items")
    if (parts.length) {
      const rows = (await db
        .prepare(`SELECT DISTINCT ON (fin_key(n)) fin_key(n) AS k, btrim(n) AS n FROM (${parts.join(" UNION ALL ")}) x WHERE fin_key(n) = ANY(@stk_names::text[]) ORDER BY fin_key(n), n`)
        .all({ stk_names: names })) as Array<{ k: string; n: string }>
      for (const row of rows) result.set(`name:${row.k}`, { name: row.n, unit: "" })
    }
    for (const name of names) if (!result.has(`name:${name}`)) result.set(`name:${name}`, { name, unit: "" })
  }
  return result
}

type Conversion = { factor: number; unit: string }

/** Totals of the counts per display unit (kg, pieces and litres are never added up). */
export type StockLevelUnitTotal = { unit: string; total: number; reserved: number; defects: number; available: number; transit: number }
/** The page totals plus `byUnit`: one line per unit of the counted rows ("" = no unit). */
export type StockLevelSumWithUnits = StockLevelSum & { byUnit: StockLevelUnitTotal[] }

function conversion(item: StockCatalogItem | undefined, unit: StockLevelQuery["unit"], fallbackUnit: string): Conversion {
  // Weight of one unit: the item's own weight, else what a weight unit implies
  // (a kg item weighs 1 kg per unit) — the same rule as the transfer documents.
  if (unit === "weight") return { factor: unitWeightKg(item?.unit ?? fallbackUnit, item?.weight ?? 0), unit: "кг" }
  if (unit === "capacity") return { factor: item?.volume ?? 0, unit: "м³" }
  if (unit === "box") return { factor: item?.boxSize ? 1 / item.boxSize : 0, unit: "блок" }
  return { factor: 1, unit: item?.unit || fallbackUnit }
}

function qty(base: { total: number; reserved: number; transit: number; defects: number }, factor: number): StockLevelQty {
  const total = round(base.total * factor)
  const reserved = round(base.reserved * factor)
  const transit = round(base.transit * factor)
  const defects = round(base.defects * factor)
  return { total, reserved, transit, defects, available: round((base.total - base.reserved - base.defects) * factor) }
}

type Built = { rows: StockLevelRow[]; sum: StockLevelSumWithUnits; currency: string; baseCurrency: string }

function matches(values: string[], value: string): boolean {
  if (!values.length) return true
  const key = nameKey(value)
  return values.some((item) => nameKey(item) === key)
}

/** Every row of the page (filtered and sorted) and its totals. */
async function buildStockLevel(query: StockLevelQuery, db: PgDb): Promise<Built> {
  const ctx = await loadContext(db)
  const byKey = new Map(ctx.catalog.map((item) => [item.key, item]))

  // Warehouses in scope: the selected ones, restricted to the selected branches.
  const wantedWarehouses = new Set(query.warehouse.map(nameKey).filter(Boolean))
  const wantedBranches = new Set(query.branch.map(nameKey))
  const inScope = (warehouseKey: string) =>
    (!wantedWarehouses.size || wantedWarehouses.has(warehouseKey)) && (!wantedBranches.size || wantedBranches.has(nameKey(ctx.branchOf.get(warehouseKey) ?? "")))

  type Acc = { total: number; defects: number; reserved: number; transit: number; cost: number | null; stocks: Map<string, { warehouse: string; total: number; defects: number; reserved: number; transit: number }> }
  const acc = new Map<string, Acc>()
  const entry = (key: string) => {
    let item = acc.get(key)
    if (!item) acc.set(key, (item = { total: 0, defects: 0, reserved: 0, transit: 0, cost: null, stocks: new Map() }))
    return item
  }
  const stock = (item: Acc, warehouse: string) => {
    const key = nameKey(warehouse)
    let line = item.stocks.get(key)
    if (!line) item.stocks.set(key, (line = { warehouse, total: 0, defects: 0, reserved: 0, transit: 0 }))
    return line
  }
  for (const row of ctx.balances) {
    const item = entry(row.key)
    item.cost = ctx.costs.get(row.key) ?? row.cost // "Общий" cost: identical on every row of the item
    if (!inScope(row.warehouseKey)) continue
    item.total += row.qty
    item.defects += row.defects
    const line = stock(item, row.warehouse)
    line.total += row.qty
    line.defects += row.defects
  }
  for (const row of ctx.pending) {
    if (!inScope(nameKey(row.warehouse))) continue
    const item = entry(row.key)
    item.reserved += row.reserved
    item.transit += row.transit
    const line = stock(item, row.warehouse)
    line.reserved += row.reserved
    line.transit += row.transit
  }

  const orphanKeys = [...acc.entries()].filter(([key, item]) => !byKey.has(key) && (item.total || item.reserved || item.transit || item.stocks.size)).map(([key]) => key)
  const orphans = orphanKeys.length ? await orphanItems(orphanKeys, db, ctx.tables) : new Map<string, { name: string; unit: string }>()

  const priceList = query.priceList.trim()
  const currency = query.mode === "price" && priceList ? (ctx.priceListCurrency.get(nameKey(priceList)) ?? ctx.baseCurrency) : ctx.baseCurrency
  const needle = nameKey(query.search)

  // Totals: counts in the display unit, money in the selected mode (amount
  // mode: valued at cost, as the demo's balances_sum does; at cost Брак has
  // no value). The count's unit is shown only when every counted row shares it.
  const sum: StockLevelSumWithUnits = {
    total: { count: 0, price: 0 },
    reserved: { count: 0, price: 0 },
    defected: { count: 0, price: 0 },
    available: { count: 0, price: 0 },
    given: 0,
    currency,
    unit: "",
    byUnit: [],
  }
  const units = new Set<string>()
  const byUnit = new Map<string, StockLevelUnitTotal>()
  const rows: StockLevelRow[] = []
  const keys = [...ctx.catalog.map((item) => item.key), ...orphanKeys]
  for (const key of keys) {
    const item = byKey.get(key)
    const orphan = orphans.get(key)
    const name = item?.name ?? orphan?.name ?? key
    if (needle && ![name, item?.article ?? "", item?.barcode ?? ""].some((value) => nameKey(value).includes(needle))) continue
    if (!matches(query.type, item?.type ?? "") || !matches(query.subcategory, item?.subcategory ?? "") || !matches(query.brand, item?.brand ?? "")) continue
    if (!matches(query.supplier, item?.supplier ?? "") || !matches(query.organization, item?.organization ?? "")) continue
    const data = acc.get(key)
    if (query.onlyHas && !((data?.total ?? 0) > 1e-9)) continue
    const cost = data?.cost ?? ctx.costs.get(key) ?? item?.fallbackCost ?? 0
    const price = query.mode === "price" && priceList ? (Object.entries(item?.prices ?? {}).find(([listName]) => nameKey(listName) === nameKey(priceList))?.[1] ?? 0) : null
    const atCost = query.mode !== "price"
    /** Money per unit of a warehouse line: its cost of goods (own scope) or the price. */
    const moneyIn = (warehouse: string) => (atCost ? (ctx.costIn(key, warehouse) ?? cost) : (price ?? 0))
    const rateIn = (warehouse: string) => (query.mode === "net_cost" || query.mode === "price" ? moneyIn(warehouse) : 0)
    const { factor, unit } = conversion(item, query.unit, orphan?.unit ?? "")
    const base = { total: data?.total ?? 0, reserved: data?.reserved ?? 0, transit: data?.transit ?? 0, defects: data?.defects ?? 0 }
    const lines = [...(data?.stocks.values() ?? [])]
    const stocks: StockLevelStock[] = lines
      .map((line) => ({
        warehouse: line.warehouse,
        branch: ctx.branchOf.get(nameKey(line.warehouse)) ?? "",
        ...qty(line, factor),
        value: round((line.total - line.reserved - line.defects) * rateIn(line.warehouse), 4),
      }))
      .sort((a, b) => a.warehouse.localeCompare(b.warehouse, "ru"))
    rows.push({
      key,
      kind: item?.kind ?? (key.startsWith("product:") ? "product" : key.startsWith("raw_material:") ? "raw_material" : null),
      id: item?.id ?? null,
      name,
      article: item?.article ?? "",
      barcode: item?.barcode ?? "",
      type: item?.type ?? "",
      subcategory: item?.subcategory ?? "",
      brand: item?.brand ?? "",
      supplier: item?.supplier ?? "",
      organization: item?.organization ?? "",
      unit,
      ...qty(base, factor),
      cost: round(cost, 6),
      price,
      value: round(lines.reduce((total, line) => total + (line.total - line.reserved - line.defects) * rateIn(line.warehouse), 0), 4),
      stocks,
    })
    const row = rows[rows.length - 1]
    sum.total.count += row.total
    sum.reserved.count += row.reserved
    sum.defected.count += row.defects
    sum.available.count += row.available
    sum.given += row.transit
    for (const line of lines) {
      const money = moneyIn(line.warehouse)
      sum.total.price += (line.total - (atCost ? line.defects : 0)) * money
      sum.reserved.price += line.reserved * money
      sum.defected.price += atCost ? 0 : line.defects * money
      sum.available.price += (line.total - line.reserved - line.defects) * money
    }
    if (row.total || row.reserved || row.defects || row.transit) {
      const unitKey = row.unit.trim().toLowerCase()
      units.add(unitKey)
      const line = byUnit.get(unitKey) ?? { unit: row.unit.trim(), total: 0, reserved: 0, defects: 0, available: 0, transit: 0 }
      line.total += row.total
      line.reserved += row.reserved
      line.defects += row.defects
      line.available += row.available
      line.transit += row.transit
      byUnit.set(unitKey, line)
    }
  }
  if (units.size === 1) sum.unit = rows.find((row) => row.total || row.reserved || row.defects || row.transit)?.unit.trim() ?? ""
  sum.byUnit = [...byUnit.values()]
    .map((line) => ({ unit: line.unit, total: round(line.total), reserved: round(line.reserved), defects: round(line.defects), available: round(line.available), transit: round(line.transit) }))
    .sort((a, b) => a.unit.localeCompare(b.unit, "ru"))

  sortRows(rows, query.ordering)
  for (const part of [sum.total, sum.reserved, sum.defected, sum.available]) {
    part.count = round(part.count)
    part.price = round(part.price, 2)
  }
  sum.given = round(sum.given)
  return { rows, sum, currency, baseCurrency: ctx.baseCurrency }
}

function sortRows(rows: StockLevelRow[], ordering: string) {
  const desc = ordering.startsWith("-")
  const field = (desc ? ordering.slice(1) : ordering) || "name"
  const text = (row: StockLevelRow) => (field === "article" ? row.article : field === "type" ? row.type : row.name)
  const number = (row: StockLevelRow): number => {
    switch (field) {
      case "total":
      case "reserved":
      case "transit":
      case "available":
      case "cost":
      case "value":
        return row[field]
      case "price":
        return row.price ?? 0
      default:
        return 0
    }
  }
  const textual = field === "name" || field === "article" || field === "type"
  rows.sort((a, b) => {
    const result = textual ? text(a).localeCompare(text(b), "ru") : number(a) - number(b)
    return (desc ? -result : result) || a.name.localeCompare(b.name, "ru") || a.key.localeCompare(b.key)
  })
}

export async function getStockLevelList(query: StockLevelQuery, db: PgDb = getDb()): Promise<StockLevelList> {
  const built = await buildStockLevel(query, db)
  const pageSize = query.pageSize > 0 ? query.pageSize : built.rows.length || 1
  const lastPage = Math.max(1, Math.ceil(built.rows.length / pageSize))
  const page = query.pageSize > 0 ? Math.min(Math.max(1, query.page), lastPage) : 1
  const rows = query.pageSize > 0 ? built.rows.slice((page - 1) * pageSize, page * pageSize) : built.rows
  return { count: built.rows.length, page, pageSize: query.pageSize, baseCurrency: built.baseCurrency, currency: built.currency, rows, sum: built.sum }
}

export async function getStockLevelSum(query: StockLevelQuery, db: PgDb = getDb()): Promise<StockLevelSumWithUnits> {
  return (await buildStockLevel(query, db)).sum
}

/** Item detail: per-warehouse breakdown and the latest receipts. */
export async function getStockItemDetail(key: string, query: Pick<StockLevelQuery, "warehouse" | "branch">, db: PgDb = getDb()): Promise<StockItemDetail | null> {
  const ctx = await loadContext(db)
  const item = ctx.catalog.find((candidate) => candidate.key === key)
  const balances = ctx.balances.filter((row) => row.key === key)
  const pending = ctx.pending.filter((row) => row.key === key)
  if (!item && !balances.length && !pending.length) return null
  const orphan = item ? undefined : (await orphanItems([key], db, ctx.tables)).get(key)

  const wantedWarehouses = new Set(query.warehouse.map(nameKey).filter(Boolean))
  const wantedBranches = new Set(query.branch.map(nameKey))
  const inScope = (warehouse: string) =>
    (!wantedWarehouses.size || wantedWarehouses.has(nameKey(warehouse))) && (!wantedBranches.size || wantedBranches.has(nameKey(ctx.branchOf.get(nameKey(warehouse)) ?? "")))

  const cost = ctx.costs.get(key) ?? balances[0]?.cost ?? item?.fallbackCost ?? 0
  const lines = new Map<string, { warehouse: string; total: number; defects: number; reserved: number; transit: number }>()
  const line = (warehouse: string) => {
    let value = lines.get(nameKey(warehouse))
    if (!value) lines.set(nameKey(warehouse), (value = { warehouse, total: 0, defects: 0, reserved: 0, transit: 0 }))
    return value
  }
  for (const row of balances) {
    if (!inScope(row.warehouse)) continue
    const value = line(row.warehouse)
    value.total += row.qty
    value.defects += row.defects
  }
  for (const row of pending) {
    if (!inScope(row.warehouse)) continue
    const value = line(row.warehouse)
    value.reserved += row.reserved
    value.transit += row.transit
  }
  const warehouses: StockLevelStock[] = [...lines.values()]
    .map((value) => ({
      warehouse: value.warehouse,
      branch: ctx.branchOf.get(nameKey(value.warehouse)) ?? "",
      ...qty(value, 1),
      value: round((value.total - value.reserved - value.defects) * (ctx.costIn(key, value.warehouse) ?? cost), 4),
    }))
    .sort((a, b) => a.warehouse.localeCompare(b.warehouse, "ru"))
  const total = qty(
    warehouses.reduce((sum, value) => ({ total: sum.total + value.total, reserved: sum.reserved + value.reserved, transit: sum.transit + value.transit, defects: sum.defects + value.defects }), { total: 0, reserved: 0, transit: 0, defects: 0 }),
    1,
  )

  const { sql, params } = await movementsQuery({}, db, ctx.tables)
  const receiptRows = (await db
    .prepare(
      `SELECT day, kind, doc_type, doc_id, warehouse, qty, value, is_defect FROM (${sql}) m
       WHERE m.item_key = @stk_key AND m.qty > 0 AND m.kind = ANY(@stk_kinds::text[])
       ORDER BY m.day DESC, m.doc_id DESC LIMIT 20`,
    )
    .all({ ...params, stk_key: key, stk_kinds: RECEIPT_KINDS })) as Array<{ day: string; kind: string; doc_type: string; doc_id: number; warehouse: string; qty: number; value: number; is_defect: number }>
  const receipts: StockReceipt[] = receiptRows
    .filter((row) => inScope(row.warehouse))
    .map((row) => ({
      day: row.day,
      kind: row.kind,
      docType: row.doc_type,
      docId: Number(row.doc_id),
      warehouse: row.warehouse,
      qty: round(row.qty),
      unitCost: row.qty ? round(Number(row.value) / Number(row.qty), 6) : 0,
      isDefect: Number(row.is_defect) === 1,
    }))

  return {
    key,
    name: item?.name ?? orphan?.name ?? key,
    unit: item?.unit ?? orphan?.unit ?? "",
    article: item?.article ?? "",
    type: item?.type ?? "",
    brand: item?.brand ?? "",
    cost: round(cost, 6),
    fallbackCost: item?.fallbackCost ?? 0,
    baseCurrency: ctx.baseCurrency,
    total,
    warehouses,
    receipts,
  }
}
