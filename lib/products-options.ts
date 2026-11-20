import "server-only"

import { getAppCurrency } from "@/lib/app-currency"
import { normCurrency } from "@/lib/finance/currency"
import type { PgDb } from "@/lib/db"
import { parseItemPrices } from "@/lib/item-prices"
import { catalogDb } from "@/lib/products-schema"
import { catalogKey, cleanText, type CatalogOptions } from "@/lib/products-types"

// GET /api/{products|raw-materials}/options — choices of the product form and filter:
// the reference tables (price lists, currencies, units, product types, brands, suppliers,
// organizations, employees as agents, supplier incomings as "Поставка") merged with the
// values the items already use, so nothing stored is missing from a select (agents: the
// active employees only, the limit API refuses other names).

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

/** Linko's order of names (its database collation): case, spaces and punctuation ignored, digits before Latin
 * before Cyrillic (the same key as the list's ordering=name). */
function linkoOrder(a: string, b: string): number {
  const key = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
  const x = key(a)
  const y = key(b)
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0
}

/** The directory's values in its own order, then the other values items carry (sorted); one spelling each. */
function inOrder(directory: unknown[], extra: unknown[]): string[] {
  const byKey = new Map<string, string>()
  for (const value of directory) {
    const clean = cleanText(value)
    if (clean && !byKey.has(catalogKey(clean))) byKey.set(catalogKey(clean), clean)
  }
  const known = new Set(byKey.keys())
  return [...byKey.values(), ...unique(extra).filter((value) => !known.has(catalogKey(value)))]
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
    // The default list ("По умолчанию для заказа") first: a new price row starts on it.
    const order = `${cols.has("is_default_for_order") ? "COALESCE(is_default_for_order, 0) DESC, " : ""}${cols.has("position") ? "position, id" : "id"}`
    const currency = cols.has("currency") ? "currency" : "''"
    const rows = (await db.prepare(`SELECT name, ${currency} AS currency FROM price_lists ${active} ORDER BY ${order}`).all()) as Array<{ name: string; currency: string }>
    // A list's currency may be stored by its name («Euro»): read back to the code (EUR), like the rest of the app.
    for (const row of rows) priceLists.push({ name: String(row.name ?? "").trim(), currency: String(row.currency ?? "").trim() ? normCurrency(String(row.currency)) : "" })
  }
  const known = new Set(priceLists.map((entry) => catalogKey(entry.name)))
  const usedPrices = await values(db, "SELECT price_lists AS v FROM products WHERE COALESCE(deleted, 0) = 0 UNION ALL SELECT price_lists FROM raw_materials WHERE COALESCE(deleted, 0) = 0")
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
  const appCurrency = tables.has("currencies") ? await getAppCurrency(db) : ""
  const currencies: string[] = []
  if (tables.has("currencies")) {
    const rows = (await db.prepare("SELECT code, name, is_base FROM currencies ORDER BY is_base DESC, id").all()) as Array<{ code: string; name: string; is_base: number }>
    for (const row of rows) currencies.push(String(row.code || row.name || "").trim())
    const base = rows.find((row) => Number(row.is_base) === 1)
    if (base) baseCurrency = String(base.code || base.name).trim() || baseCurrency
  }
  // The base currency first (a new price row defaults to currencies[0]), the others sorted.
  const allCurrencies = [
    baseCurrency,
    ...unique([...currencies, ...usedCurrencies, ...priceLists.map((entry) => entry.currency)].map((code) => (String(code ?? "").trim() ? normCurrency(String(code)) : ""))).filter(
      (code) => catalogKey(code) !== catalogKey(baseCurrency),
    ),
  ]

  // «Тип продукта» lists the top-level types only (Linko's product_type/?parent=0), «Подкатегория» the children of the
  // chosen one; `id` / `childIds` are what the list filter puts in the URL (typeParent=306, like Linko).
  const types = new Map<string, { id?: number; name: string; children: Map<string, string>; childIds: Record<string, number> }>()
  const addType = (parent: unknown, child?: unknown, ids?: { parent?: number; child?: number }) => {
    const name = cleanText(parent)
    if (!name) return
    const key = catalogKey(name)
    if (!types.has(key)) types.set(key, { id: ids?.parent, name, children: new Map(), childIds: {} })
    const entry = types.get(key)!
    if (entry.id === undefined && ids?.parent !== undefined) entry.id = ids.parent
    const sub = cleanText(child)
    if (sub && !entry.children.has(catalogKey(sub))) entry.children.set(catalogKey(sub), sub)
    if (sub && ids?.child !== undefined && entry.childIds[sub] === undefined) entry.childIds[sub] = ids.child
  }
  const childNames = new Set<string>()
  if (tables.has("product_types")) {
    const rows = (await db
      .prepare(
        "SELECT t.id, t.name, p.id AS parent_id, p.name AS parent, p.parent_id AS grand_id FROM product_types t LEFT JOIN product_types p ON p.id = t.parent_id ORDER BY t.id",
      )
      .all()) as Array<{ id: number; name: string; parent_id: number | null; parent: string | null; grand_id: number | null }>
    for (const row of rows) if (!row.parent) addType(row.name, undefined, { parent: Number(row.id) })
    for (const row of rows) {
      if (!row.parent) continue
      childNames.add(catalogKey(row.name))
      // A child of a child is no «Подкатегория» of a top-level type (and its parent is no top-level type).
      if (row.grand_id === null) addType(row.parent, row.name, { parent: Number(row.parent_id), child: Number(row.id) })
    }
  }
  const itemTypes = (await db
    .prepare("SELECT type, subcategory FROM products WHERE COALESCE(deleted, 0) = 0 UNION SELECT type, subcategory FROM raw_materials WHERE COALESCE(deleted, 0) = 0")
    .all()) as Array<{
    type: string
    subcategory: string
  }>
  // A product whose own type is a child type keeps it in `type` (Linko's product has one type): that name is a
  // «Подкатегория», not a top-level type of its own.
  for (const row of itemTypes) {
    const key = catalogKey(cleanText(row.type))
    if (childNames.has(key) && !types.has(key)) continue
    addType(row.type, row.subcategory)
  }

  const table = (name: string, sql: string) => (tables.has(name) ? values(db, sql) : Promise.resolve([] as string[]))
  // Бренд / Поставщик / Организация pickers offer only their directories: the server accepts
  // nothing else for a changed value (lib/products-validate.ts); an item's own legacy value
  // stays visible in its form and is kept unchanged on save. The filter also lists the
  // free-text values items still carry.
  const [units, brands, suppliers, organizations, employees, itemUnits, itemBrands, itemSuppliers, itemOrganizations, colors] = await Promise.all([
    // Linko's orders: measurements and providers newest first (their lists' default), brands and divisions by name.
    table("units_of_measure", "SELECT name AS v FROM units_of_measure ORDER BY id DESC"),
    table("brands", "SELECT name AS v FROM brands"),
    table("suppliers", "SELECT name AS v FROM suppliers ORDER BY id DESC"),
    table("organizations", "SELECT name AS v FROM organizations"),
    table("employees", "SELECT btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS v FROM employees WHERE COALESCE(active, 1) <> 0"),
    values(db, ITEMS("unit")),
    values(db, ITEMS("brand")),
    values(db, ITEMS("supplier")),
    values(db, ITEMS("organization")),
    values(db, ITEMS("color")),
  ])

  // The list filter's Мера / Бренд / Поставщик / Организации: every directory row by its own spelling (Linko lists
  // «шт» and «ШТ», «Coca cola» and «Coca Cola» apart) with its id, which the filter puts in the URL (measurement=17,
  // brand=85, division=59, like Linko); values only items carry follow without an id.
  const directory = async (name: string, order: string) =>
    tables.has(name) ? ((await db.prepare(`SELECT id, name FROM ${name} ORDER BY ${order}`).all()) as Array<{ id: number; name: string }>) : []
  const [unitRows, brandRows, supplierRows, organizationRows] = await Promise.all([
    directory("units_of_measure", "id DESC"),
    directory("brands", "id"),
    directory("suppliers", "id DESC"),
    directory("organizations", "id"),
  ])
  const filterList = (rows: Array<{ id: number; name: string }>, extra: unknown[], sorted: boolean) => {
    const ids: Record<string, number> = {}
    for (const row of rows) {
      const name = cleanText(row.name)
      if (name && ids[name] === undefined) ids[name] = Number(row.id)
    }
    const names = Object.keys(ids)
    const known = new Set(names.map((name) => catalogKey(name)))
    const all = [...names, ...unique(extra).filter((value) => !known.has(catalogKey(value)))]
    return { values: sorted ? all.sort(linkoOrder) : all, ids }
  }
  const unitFilter = filterList(unitRows, itemUnits, false)
  const brandFilter = filterList(brandRows, itemBrands, true)
  const supplierFilter = filterList(supplierRows, itemSuppliers, false)
  const organizationFilter = filterList(organizationRows, itemOrganizations, true)

  // «Характеристика» fields of the form (Справочник → Атрибуты with their values).
  let attributes: NonNullable<CatalogOptions["attributes"]> = []
  if ((await existing(db, ["product_attributes"])).has("product_attributes")) {
    const rows = (await db.prepare("SELECT id, name, field_type, all_types, types_json FROM product_attributes ORDER BY id").all()) as Array<{
      id: number
      name: string
      field_type: string
      all_types: number
      types_json: string
    }>
    const valueRows = (await existing(db, ["product_attribute_values"])).has("product_attribute_values")
      ? ((await db.prepare("SELECT attribute, values_json FROM product_attribute_values ORDER BY id").all()) as Array<{ attribute: string; values_json: string }>)
      : []
    const list = (json: string): string[] => {
      try {
        const value = JSON.parse(json) as unknown
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : []
      } catch {
        return []
      }
    }
    const fieldType = (value: string) => (/цифр/i.test(value) ? "number" : /текст/i.test(value) ? "text" : "select")
    attributes = rows
      .map((row) => ({
        id: Number(row.id),
        name: cleanText(row.name),
        fieldType: fieldType(String(row.field_type ?? "")) as "select" | "text" | "number",
        values: [...new Set(valueRows.filter((value) => catalogKey(value.attribute) === catalogKey(row.name)).flatMap((value) => list(value.values_json)))],
        allTypes: Number(row.all_types) === 1,
        types: list(row.types_json),
      }))
      .filter((attribute) => attribute.name)
      // Linko's order: the select attributes first, then by id.
      .sort((a, b) => Number(b.fieldType === "select") - Number(a.fieldType === "select") || a.id - b.id)
  }

  let supplies: CatalogOptions["supplies"] = []
  if (tables.has("supplier_incomings")) {
    const rows = (await db.prepare("SELECT id, supplier, date, contract_number FROM supplier_incomings ORDER BY id DESC LIMIT 300").all()) as Array<{
      id: number
      supplier: string
      date: string
      contract_number: string | null
    }>
    // Linko's option: «Поставка №353», «Поставщик: …», «Номер договора: …» (the filter builds the translated text).
    supplies = rows.map((row) => ({
      id: Number(row.id),
      label: `№ ${row.id} · ${cleanText(row.supplier) || "—"}${row.date ? ` · ${row.date}` : ""}`,
      supplier: cleanText(row.supplier),
      contract: cleanText(row.contract_number),
    }))
  }

  return {
    priceLists: priceLists.filter((entry) => entry.name),
    // With an app currency (Настройки → Валюта приложения) prices are entered only in it; `baseCurrency` stays the
    // real one (the currency of a stored price without its own).
    currencies: appCurrency ? [appCurrency] : allCurrencies.length ? allCurrencies : ["SUM"],
    baseCurrency,
    units: inOrder(units, itemUnits),
    types: [...types.values()]
      .map((type) => ({ id: type.id, name: type.name, children: [...type.children.values()].sort(linkoOrder), childIds: type.childIds }))
      .sort((a, b) => linkoOrder(a.name, b.name)),
    brands: unique(brands).sort(linkoOrder),
    suppliers: inOrder(suppliers, []),
    organizations: unique(organizations).sort(linkoOrder),
    filterValues: {
      brands: brandFilter.values,
      suppliers: supplierFilter.values,
      organizations: organizationFilter.values,
      units: unitFilter.values,
    },
    filterIds: { units: unitFilter.ids, brands: brandFilter.ids, suppliers: supplierFilter.ids, organizations: organizationFilter.ids },
    colors: unique(colors).sort(linkoOrder),
    // "Добавить лимит" accepts employees only (POST …/limits checks the names).
    agents: unique(employees),
    supplies,
    attributes,
  }
}
