import "server-only"

import type { PgDb } from "@/lib/db"
import { catalogRefLabel } from "@/lib/catalog-refs"
import type { DictionaryUsage } from "@/components/analytics/dictionaries-data"

// Where the catalog dictionaries are referenced. Products and raw materials store the
// NAMES as text (the demo links by id), so a rename is carried into every storing column
// in the caller's transaction and a delete is refused while the name is used. Names are
// matched with fin_key() (lower-case, trimmed, whitespace collapsed). Columns are
// discovered from information_schema on every call because most document tables are
// created lazily by their modules.
//
// Типы продуктов (two levels):
//   top-level type → products.type, raw_materials.type (+ production_recipes.item_type, a
//   snapshot of the item's type: follows renames, never blocks a delete);
//   child type ("Подкатегория") → the pair (type = parent, subcategory = child).
//   Moving a child to another parent / to the top level moves its items with it (the demo
//   items point at the type id).
// Ед.измерения:
//   products / raw_materials .unit and .product_group (group unit) by name, .sub_unit
//   ("6 шт", legacy "Блок 10 шт") by the exact unit token, the "unit" of every
//   .box_sizes entry ("ДОП. параметры": [{unit, height, width, length}]); document lines: any text column
//   `unit` (order_items, production_movements, production_recipes, production_recipe_items,
//   stock_inventory_items, …) and the "unit" field of JSON line arrays (items / lines /
//   products: write_offs, internal_transfers, repricings, production_inventories, …).
//   Not rewritten: invoice_incoming_items.unit (the supplier's e-invoice text).
// Бренд: any text column `brand` (products, raw_materials, …).
// History tables (*_log / *_logs) follow a rename but never block a delete.

export type DictionaryRenameChange = { table: string; column: string; rows: number }

const OWN_TABLES = new Set(["product_types", "units_of_measure", "brands"])
const CATALOG_TABLES = ["products", "raw_materials"] as const
const NOT_REFS = new Set(["invoice_incoming_items.unit"])
const JSON_COLUMNS = new Set(["items", "lines", "products"])

const LABELS: Record<string, string> = {
  products: "Продукты",
  raw_materials: "Сырье",
  product_types: "Подкатегории",
  units_of_measure: "Дочерние единицы измерения",
  product_type_restrictions: "Ограничение продуктов",
}

function label(table: string): string {
  return LABELS[table] ?? catalogRefLabel(table)
}

const isHistory = (table: string) => /_logs?$/.test(table)

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** The column parsed as a JSON array ('[]' when blank, invalid or not an array). */
function jsonArray(column: string): string {
  return `COALESCE(CASE WHEN pg_input_is_valid(${column}, 'jsonb') THEN CASE WHEN jsonb_typeof(${column}::jsonb) = 'array' THEN ${column}::jsonb END END, '[]'::jsonb)`
}

type Columns = Map<string, Map<string, string>>

async function baseColumns(db: PgDb): Promise<Columns> {
  const rows = (await db
    .prepare(
      `SELECT c.table_name, c.column_name, c.data_type
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE'
          AND c.column_name IN ('type', 'subcategory', 'item_type', 'item_kind', 'item_id', 'unit', 'product_group', 'sub_unit', 'box_sizes', 'brand', 'items', 'lines', 'products')
        ORDER BY c.table_name, c.column_name`,
    )
    .all()) as Array<{ table_name: string; column_name: string; data_type: string }>
  const columns: Columns = new Map()
  for (const row of rows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Map())
    columns.get(row.table_name)!.set(row.column_name, row.data_type)
  }
  return columns
}

const textual = (type: string | undefined) => type === "text" || type === "character varying"
const has = (columns: Columns, table: string, column: string) => textual(columns.get(table)?.get(column))

async function count(db: PgDb, sql: string, params: Record<string, unknown>): Promise<number> {
  const row = (await db.prepare(sql).get(params)) as { n: string | number } | undefined
  return Number(row?.n ?? 0)
}

function addUsage(usage: Map<string, number>, table: string, n: number) {
  if (n > 0) usage.set(table, (usage.get(table) ?? 0) + n)
}

function usageList(usage: Map<string, number>): DictionaryUsage[] {
  return [...usage].map(([table, n]) => ({ table, label: label(table), count: n }))
}

// ---------------------------------------------------------------------------
// Типы продуктов
// ---------------------------------------------------------------------------

/** A type's place in the tree: `parent` = the parent's name (null = top level). */
export type TypePath = { name: string; parent: string | null }

function typeMatch(path: TypePath): string {
  return path.parent === null ? "fin_key(type) = fin_key(@name)" : "fin_key(type) = fin_key(@parent) AND fin_key(subcategory) = fin_key(@name)"
}

export async function productTypeUsage(db: PgDb, type: { id: number } & TypePath): Promise<DictionaryUsage[]> {
  const columns = await baseColumns(db)
  const usage = new Map<string, number>()
  for (const table of CATALOG_TABLES) {
    if (!has(columns, table, "type") || (type.parent !== null && !has(columns, table, "subcategory"))) continue
    addUsage(usage, table, await count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${typeMatch(type)}`, { name: type.name, parent: type.parent }))
  }
  addUsage(usage, "product_types", await count(db, "SELECT COUNT(*) AS n FROM product_types WHERE parent_id = @id", { id: type.id }))
  // Ограничение продуктов: an agent's product type list (the FK would cascade the type away and
  // silently lift the agent's restriction).
  const restrictions = (await db.prepare("SELECT to_regclass('product_type_restrictions') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (restrictions?.ok) {
    addUsage(usage, "product_type_restrictions", await count(db, "SELECT COUNT(*) AS n FROM product_type_restrictions WHERE product_type_id = @id", { id: type.id }))
  }
  return usageList(usage)
}

/**
 * Carries a rename / move of a type into the items (see the header). Run it inside the
 * transaction that updates the product_types row.
 */
export async function cascadeProductTypeChange(db: PgDb, before: TypePath, after: TypePath): Promise<DictionaryRenameChange[]> {
  if (before.name === after.name && before.parent === after.parent) return []
  const columns = await baseColumns(db)
  const changes: DictionaryRenameChange[] = []
  const params = { old: before.name, oldParent: before.parent ?? "", new: after.name, newParent: after.parent ?? "" }
  for (const table of CATALOG_TABLES) {
    if (!has(columns, table, "type") || !has(columns, table, "subcategory")) continue
    let sql: string
    if (before.parent === null && after.parent === null) {
      sql = `UPDATE ${table} SET type = @new WHERE fin_key(type) = fin_key(@old) AND type IS DISTINCT FROM @new`
    } else if (before.parent === null) {
      sql = `UPDATE ${table} SET type = @newParent, subcategory = @new WHERE fin_key(type) = fin_key(@old)`
    } else if (after.parent === null) {
      sql = `UPDATE ${table} SET type = @new, subcategory = '' WHERE fin_key(type) = fin_key(@oldParent) AND fin_key(subcategory) = fin_key(@old)`
    } else {
      sql = `UPDATE ${table} SET type = @newParent, subcategory = @new
              WHERE fin_key(type) = fin_key(@oldParent) AND fin_key(subcategory) = fin_key(@old)
                AND (type IS DISTINCT FROM @newParent OR subcategory IS DISTINCT FROM @new)`
    }
    const result = await db.prepare(sql).run(params)
    if (result.changes > 0) changes.push({ table, column: before.parent === null && after.parent === null ? "type" : "type, subcategory", rows: result.changes })
  }
  // production_recipes.item_type = a snapshot of the item's type.
  if (has(columns, "production_recipes", "item_type")) {
    let rows = 0
    if (before.parent === null && after.parent === null) {
      rows = (await db.prepare("UPDATE production_recipes SET item_type = @new WHERE fin_key(item_type) = fin_key(@old) AND item_type IS DISTINCT FROM @new").run(params)).changes
    } else if (columns.get("production_recipes")?.has("item_kind") && columns.get("production_recipes")?.has("item_id")) {
      for (const [kind, table] of [["product", "products"], ["raw_material", "raw_materials"]] as const) {
        const result = await db
          .prepare(
            `UPDATE production_recipes r SET item_type = c.type FROM ${table} c
              WHERE r.item_kind = @kind AND r.item_id = c.id AND r.item_type IS DISTINCT FROM c.type
                AND (fin_key(r.item_type) = fin_key(@old) OR (@oldParent::text <> '' AND fin_key(r.item_type) = fin_key(@oldParent)))`,
          )
          .run({ ...params, kind })
        rows += result.changes
      }
    }
    if (rows > 0) changes.push({ table: "production_recipes", column: "item_type", rows })
  }
  return changes
}

// ---------------------------------------------------------------------------
// Ед.измерения
// ---------------------------------------------------------------------------

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.|?*+()[\]{}]/g, "\\$&")
}

/** Postgres ARE matching the unit as a whole token of sub_unit ("6 шт", "Блок 10 шт"). */
function unitTokenPattern(name: string): string {
  const body = name
    .trim()
    .split(/[\s  ]+/)
    .map(escapeRegex)
    .join("\\s+")
  return `(^|\\s)${body}(?=\\s|$)`
}

type UnitRefs = { text: Array<{ table: string; column: string }>; json: Array<{ table: string; column: string }> }

function unitDocumentRefs(columns: Columns): UnitRefs {
  const refs: UnitRefs = { text: [], json: [] }
  for (const [table, tableColumns] of columns) {
    if (OWN_TABLES.has(table) || (CATALOG_TABLES as readonly string[]).includes(table)) continue
    for (const [column, type] of tableColumns) {
      if (!textual(type) || NOT_REFS.has(`${table}.${column}`)) continue
      if (column === "unit") refs.text.push({ table, column })
      else if (JSON_COLUMNS.has(column)) refs.json.push({ table, column })
    }
  }
  return refs
}

const UNIT_ELEMENT = `(jsonb_typeof(e) = 'object' AND jsonb_typeof(e -> 'unit') = 'string' AND fin_key(e ->> 'unit') = fin_key(@old))`

/** Rows of a JSON line column that have an element with the unit. */
function unitJsonCondition(column: string): string {
  return `EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonArray(column)}) AS x(e) WHERE ${UNIT_ELEMENT})`
}

/** UPDATE of a JSON line column: every element with the old unit gets the new name (element order kept). */
function unitJsonRename(table: string, column: string): string {
  return `UPDATE ${table} SET ${column} = (
           SELECT jsonb_agg(CASE WHEN ${UNIT_ELEMENT} THEN jsonb_set(e, '{unit}', to_jsonb(@new::text)) ELSE e END ORDER BY o)
             FROM jsonb_array_elements(${jsonArray(column)}) WITH ORDINALITY AS x(e, o)
         )::text
         WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonArray(column)}) AS x(e) WHERE ${UNIT_ELEMENT} AND (e ->> 'unit') IS DISTINCT FROM @new::text)`
}

export async function unitUsage(db: PgDb, unit: { id: number; name: string }): Promise<DictionaryUsage[]> {
  const columns = await baseColumns(db)
  const usage = new Map<string, number>()
  const params = { old: unit.name, pattern: unitTokenPattern(unit.name) }
  for (const table of CATALOG_TABLES) {
    const conditions = [
      has(columns, table, "unit") ? "fin_key(unit) = fin_key(@old)" : "",
      has(columns, table, "product_group") ? "fin_key(product_group) = fin_key(@old)" : "",
      has(columns, table, "sub_unit") ? "sub_unit ~* @pattern" : "",
      has(columns, table, "box_sizes") ? unitJsonCondition("box_sizes") : "",
    ].filter(Boolean)
    if (conditions.length) addUsage(usage, table, await count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${conditions.join(" OR ")}`, params))
  }
  const refs = unitDocumentRefs(columns)
  for (const ref of refs.text) {
    if (isHistory(ref.table)) continue
    addUsage(usage, ref.table, await count(db, `SELECT COUNT(*) AS n FROM ${q(ref.table)} WHERE fin_key(${q(ref.column)}) = fin_key(@old)`, params))
  }
  for (const ref of refs.json) {
    if (isHistory(ref.table)) continue
    const sql = `SELECT COUNT(*) AS n FROM ${q(ref.table)} WHERE ${unitJsonCondition(q(ref.column))}`
    addUsage(usage, ref.table, await count(db, sql, params))
  }
  addUsage(usage, "units_of_measure", await count(db, "SELECT COUNT(*) AS n FROM units_of_measure WHERE parent_id = @id", { id: unit.id }))
  return usageList(usage)
}

/** Carries a unit rename into the items and the document lines (caller's transaction). */
export async function cascadeUnitRename(db: PgDb, oldName: string, newName: string): Promise<DictionaryRenameChange[]> {
  if (oldName === newName) return []
  const columns = await baseColumns(db)
  const changes: DictionaryRenameChange[] = []
  const record = (table: string, column: string, rows: number) => {
    if (rows > 0) changes.push({ table, column, rows })
  }
  // Replacement text of regexp_replace: \1 + the new name (a literal backslash is "\\").
  const params = { old: oldName, new: newName, pattern: unitTokenPattern(oldName), replacement: `\\1${newName.trim().replace(/\\/g, "\\\\")}` }
  for (const table of CATALOG_TABLES) {
    for (const column of ["unit", "product_group"]) {
      if (!has(columns, table, column)) continue
      const result = await db.prepare(`UPDATE ${table} SET ${column} = @new WHERE fin_key(${column}) = fin_key(@old) AND ${column} IS DISTINCT FROM @new`).run(params)
      record(table, column, result.changes)
    }
    if (has(columns, table, "sub_unit")) {
      const result = await db
        .prepare(
          `UPDATE ${table} SET sub_unit = regexp_replace(sub_unit, @pattern, @replacement, 'gi')
            WHERE sub_unit ~* @pattern AND regexp_replace(sub_unit, @pattern, @replacement, 'gi') IS DISTINCT FROM sub_unit`,
        )
        .run(params)
      record(table, "sub_unit", result.changes)
    }
    if (has(columns, table, "box_sizes")) {
      const result = await db.prepare(unitJsonRename(table, "box_sizes")).run(params)
      record(table, "box_sizes[].unit", result.changes)
    }
  }
  const refs = unitDocumentRefs(columns)
  for (const ref of refs.text) {
    const column = q(ref.column)
    const result = await db.prepare(`UPDATE ${q(ref.table)} SET ${column} = @new WHERE fin_key(${column}) = fin_key(@old) AND ${column} IS DISTINCT FROM @new`).run(params)
    record(ref.table, ref.column, result.changes)
  }
  for (const ref of refs.json) {
    const result = await db.prepare(unitJsonRename(q(ref.table), q(ref.column))).run(params)
    record(ref.table, `${ref.column}[].unit`, result.changes)
  }
  return changes
}

// ---------------------------------------------------------------------------
// Бренд
// ---------------------------------------------------------------------------

function brandColumns(columns: Columns): string[] {
  return [...columns].filter(([table, tableColumns]) => !OWN_TABLES.has(table) && textual(tableColumns.get("brand"))).map(([table]) => table)
}

export async function brandUsage(db: PgDb, brand: { name: string }): Promise<DictionaryUsage[]> {
  const usage = new Map<string, number>()
  for (const table of brandColumns(await baseColumns(db))) {
    if (isHistory(table)) continue
    addUsage(usage, table, await count(db, `SELECT COUNT(*) AS n FROM ${q(table)} WHERE fin_key(brand) = fin_key(@old)`, { old: brand.name }))
  }
  return usageList(usage)
}

export async function cascadeBrandRename(db: PgDb, oldName: string, newName: string): Promise<DictionaryRenameChange[]> {
  if (oldName === newName) return []
  const changes: DictionaryRenameChange[] = []
  for (const table of brandColumns(await baseColumns(db))) {
    const result = await db.prepare(`UPDATE ${q(table)} SET brand = @new WHERE fin_key(brand) = fin_key(@old) AND brand IS DISTINCT FROM @new`).run({ old: oldName, new: newName })
    if (result.changes > 0) changes.push({ table, column: "brand", rows: result.changes })
  }
  return changes
}
