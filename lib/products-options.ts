import "server-only"

import type { PgDb } from "@/lib/db"
import { parseItemPrices } from "@/lib/item-prices"
import { catalogDb } from "@/lib/products-schema"
import { catalogKey, cleanText, type CatalogOptions } from "@/lib/products-types"

// GET /api/{products|raw-materials}/options — choices of the product form and filter:
// the reference tables (price lists, currencies, units, product types, brands, suppliers,
// organizations, employees as agents, supplier incomings as "Поставка") merged with the
// values the items already use, so nothing stored is missing from a select.

async function existing(db: PgDb, tables: string[]): Promise<Set<string>> {
  const rows = (await db
    .prepare("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY(@tables::text[])")
    .all({ tables })) as Array<{ table_name: string }>
  return new Set(rows.map((row) => row.table_name))
}

async function columnsOf(db: PgDb, table: string): Promise<Set<string>> {
  const rows = (await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = @table").all({ table })) as Array<{
    column_name: string
  }>
  return new Set(rows.map((row) => row.column_name))
}

/** Unique clean values, first spelling wins, sorted (ru). */
function unique(values: unknown[]): string[] {
  const byKey = new Map<string, string>()
  for (const value of values) {
    const clean = cleanText(value)
    if (clean && !byKey.has(catalogKey(clean))) byKey.set(catalogKey(clean), clean)
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "ru"))
}

async function values(db: PgDb, sql: string): Promise<string[]> {
  return ((await db.prepare(sql).all()) as Array<{ v: unknown }>).map((row) => String(row.v ?? ""))
}

const ITEMS = (column: string) => `SELECT ${column} AS v FROM products UNION ALL SELECT ${column} FROM raw_materials`

export async function getCatalogOptions(): Promise<CatalogOptions> {
  const db = await catalogDb()
  const tables = await existing(db, ["price_lists", "currencies", "units_of_measure", "product_types", "brands", "suppliers", "organizations", "employees", "supplier_incomings"])

  // Price lists: the table (active ones, by position when those columns exist) + names used by items.
  const priceLists: CatalogOptions["priceLists"] = []
  if (tables.has("price_lists")) {
    const cols = await columnsOf(db, "price_lists")
    const active = cols.has("is_active") ? "WHERE COALESCE(is_active, 1) <> 0" : ""
    const order = cols.has("position") ? "position, id" : "id"
    const currency = cols.has("currency") ? "currency" : "''"
    const rows = (await db.prepare(`SELECT name, ${currency} AS currency FROM price_lists ${active} ORDER BY ${order}`).all()) as Array<{ name: string; currency: string }>
    for (const row of rows) priceLists.push({ name: String(row.name ?? "").trim(), currency: String(row.currency ?? "") })
  }
  const known = new Set(priceLists.map((entry) => catalogKey(entry.name)))
  const usedPrices = await values(db, "SELECT price_lists AS v FROM products UNION ALL SELECT price_lists FROM raw_materials")
  const usedCurrencies: string[] = []
  for (const json of usedPrices) {
    for (const entry of parseItemPrices(json)) {
      if (!known.has(catalogKey(entry.name))) {
        known.add(catalogKey(entry.name))
        priceLists.push({ name: entry.name, currency: entry.currency ?? "" })
      }
      usedCurrencies.push(entry.currency ?? "", entry.nonCashCurrency ?? "")
    }
  }

  let baseCurrency = "SUM"
  const currencies: string[] = []
  if (tables.has("currencies")) {
    const rows = (await db.prepare("SELECT code, name, is_base FROM currencies ORDER BY is_base DESC, id").all()) as Array<{ code: string; name: string; is_base: number }>
    for (const row of rows) currencies.push(String(row.code || row.name || "").trim())
    const base = rows.find((row) => Number(row.is_base) === 1)
    if (base) baseCurrency = String(base.code || base.name).trim() || baseCurrency
  }
  const allCurrencies = unique([baseCurrency, ...currencies, ...usedCurrencies, ...priceLists.map((entry) => entry.currency)])

  const types = new Map<string, { name: string; children: Map<string, string> }>()
  const addType = (parent: unknown, child?: unknown) => {
    const name = cleanText(parent)
    if (!name) return
    const key = catalogKey(name)
    if (!types.has(key)) types.set(key, { name, children: new Map() })
    const sub = cleanText(child)
    if (sub && !types.get(key)!.children.has(catalogKey(sub))) types.get(key)!.children.set(catalogKey(sub), sub)
  }
  if (tables.has("product_types")) {
    const rows = (await db.prepare("SELECT t.name, p.name AS parent FROM product_types t LEFT JOIN product_types p ON p.id = t.parent_id ORDER BY t.id").all()) as Array<{
      name: string
      parent: string | null
    }>
    for (const row of rows) if (!row.parent) addType(row.name)
    for (const row of rows) if (row.parent) addType(row.parent, row.name)
  }
  const itemTypes = (await db.prepare("SELECT type, subcategory FROM products UNION SELECT type, subcategory FROM raw_materials").all()) as Array<{
    type: string
    subcategory: string
  }>
  for (const row of itemTypes) addType(row.type, row.subcategory)

  const table = (name: string, sql: string) => (tables.has(name) ? values(db, sql) : Promise.resolve([] as string[]))
  const [units, brands, suppliers, organizations, employees, itemUnits, itemBrands, itemSuppliers, itemOrganizations, colors, limitAgents] = await Promise.all([
    table("units_of_measure", "SELECT name AS v FROM units_of_measure"),
    table("brands", "SELECT name AS v FROM brands"),
    table("suppliers", "SELECT name AS v FROM suppliers"),
    table("organizations", "SELECT name AS v FROM organizations"),
    table("employees", "SELECT btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS v FROM employees WHERE COALESCE(active, 1) <> 0"),
    values(db, ITEMS("unit")),
    values(db, ITEMS("brand")),
    values(db, ITEMS("supplier")),
    values(db, ITEMS("organization")),
    values(db, ITEMS("color")),
    values(db, "SELECT agent AS v FROM product_limits"),
  ])

  let supplies: CatalogOptions["supplies"] = []
  if (tables.has("supplier_incomings")) {
    const rows = (await db.prepare("SELECT id, supplier, date FROM supplier_incomings ORDER BY id DESC LIMIT 300").all()) as Array<{ id: number; supplier: string; date: string }>
    supplies = rows.map((row) => ({ id: Number(row.id), label: `№ ${row.id} · ${cleanText(row.supplier) || "—"}${row.date ? ` · ${row.date}` : ""}` }))
  }

  return {
    priceLists: priceLists.filter((entry) => entry.name),
    currencies: allCurrencies.length ? allCurrencies : ["SUM"],
    baseCurrency,
    units: unique([...units, ...itemUnits]),
    types: [...types.values()]
      .map((type) => ({ name: type.name, children: [...type.children.values()].sort((a, b) => a.localeCompare(b, "ru")) }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    brands: unique([...brands, ...itemBrands]),
    suppliers: unique([...suppliers, ...itemSuppliers]),
    organizations: unique([...organizations, ...itemOrganizations]),
    colors: unique(colors),
    agents: unique([...employees, ...limitAgents]),
    supplies,
  }
}
