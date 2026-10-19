import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { nameKey, placeName } from "@/lib/finance/entities"
import { loadStockCatalog } from "@/lib/stock/catalog"
import { stockTables, type StockTables } from "@/lib/stock/schema"

// Filter options of the stock pages (GET /api/stock/options): registry tables
// first, then values only seen on the catalog / documents, de-duplicated by
// normalised name and sorted.

export type StockOptions = {
  warehouses: Array<{ name: string; branch: string }>
  types: string[]
  subcategories: string[]
  brands: string[]
  suppliers: string[]
  organizations: string[]
  branches: string[]
  priceLists: string[]
  /** Currency of each price list (price_lists.currency), by name. */
  priceListCurrency: Record<string, string>
}

function unique(values: Iterable<unknown>): string[] {
  const seen = new Map<string, string>()
  for (const value of values) {
    const name = placeName(value)
    const key = nameKey(name)
    if (key && !seen.has(key)) seen.set(key, name)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"))
}

async function names(db: PgDb, t: StockTables, table: string, where = ""): Promise<string[]> {
  if (!t.has(table) && !(await tableExists(db, table))) return []
  const rows = (await db.prepare(`SELECT name FROM ${table} ${where}`).all()) as Array<{ name: string }>
  return rows.map((row) => row.name)
}

async function tableExists(db: PgDb, table: string): Promise<boolean> {
  const row = (await db.prepare("SELECT to_regclass(@stk_table) IS NOT NULL AS ok").get({ stk_table: table })) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

/** Warehouse names written on the stock documents (some may not be registered). */
async function documentWarehouses(db: PgDb, t: StockTables): Promise<string[]> {
  const parts: string[] = []
  for (const table of ["supplier_incomings", "supplier_returns", "write_offs", "production_movements"]) {
    if (t.col(table, "warehouse")) parts.push(`SELECT warehouse AS name FROM ${table}`)
  }
  if (t.has("internal_transfers")) parts.push("SELECT from_warehouse FROM internal_transfers", "SELECT to_warehouse FROM internal_transfers")
  if (t.has("stock_inventories")) parts.push("SELECT warehouse FROM stock_inventories")
  if (!parts.length) return []
  const rows = (await db.prepare(`SELECT DISTINCT name FROM (${parts.join(" UNION ALL ")}) x WHERE btrim(COALESCE(name, '')) <> ''`).all()) as Array<{ name: string }>
  return rows.map((row) => row.name)
}

export async function getStockOptions(db: PgDb = getDb()): Promise<StockOptions> {
  const t = await stockTables(db)
  const [catalog, docWarehouses] = await Promise.all([loadStockCatalog(db, t), documentWarehouses(db, t)])

  const warehouseRows = t.has("warehouses")
    ? ((await db.prepare("SELECT name, branch FROM warehouses ORDER BY name").all()) as Array<{ name: string; branch: string | null }>)
    : []
  const warehouses = new Map<string, { name: string; branch: string }>()
  for (const row of warehouseRows) {
    const key = nameKey(row.name)
    if (key && !warehouses.has(key)) warehouses.set(key, { name: row.name, branch: placeName(row.branch) })
  }
  for (const name of docWarehouses) {
    const key = nameKey(name)
    if (key && !warehouses.has(key)) warehouses.set(key, { name: name.trim(), branch: "" })
  }

  const hasParent = await tableExists(db, "product_types")
  const [rootTypes, childTypes, brands, suppliers, organizations, branches] = await Promise.all([
    hasParent ? names(db, t, "product_types", "WHERE parent_id IS NULL") : Promise.resolve([]),
    hasParent ? names(db, t, "product_types", "WHERE parent_id IS NOT NULL") : Promise.resolve([]),
    names(db, t, "brands"),
    names(db, t, "suppliers"),
    names(db, t, "organizations"),
    names(db, t, "branches"),
  ])

  const priceListCurrency: Record<string, string> = {}
  if (await tableExists(db, "price_lists")) {
    const rows = (await db.prepare("SELECT name, currency FROM price_lists ORDER BY id").all()) as Array<{ name: string; currency: string | null }>
    for (const row of rows) if (row.name?.trim() && !(row.name.trim() in priceListCurrency)) priceListCurrency[row.name.trim()] = row.currency ?? ""
  }

  return {
    warehouses: [...warehouses.values()].sort((a, b) => a.name.localeCompare(b.name, "ru")),
    types: unique([...rootTypes, ...catalog.map((item) => item.type)]),
    subcategories: unique([...childTypes, ...catalog.map((item) => item.subcategory)]),
    brands: unique([...brands, ...catalog.map((item) => item.brand)]),
    suppliers: unique([...suppliers, ...catalog.map((item) => item.supplier)]),
    organizations: unique([...organizations, ...catalog.map((item) => item.organization)]),
    branches: unique([...branches, ...[...warehouses.values()].map((warehouse) => warehouse.branch)]),
    priceLists: unique([...Object.keys(priceListCurrency), ...catalog.flatMap((item) => Object.keys(item.prices))]),
    priceListCurrency,
  }
}
