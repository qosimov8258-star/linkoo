import "server-only"

import type { PgDb } from "@/lib/db"
import type { CatalogKind, CatalogUsage } from "@/lib/products-types"
import { usageTableLabel } from "@/lib/usage-labels"

// Where products and raw materials are referenced, for the hard-delete check and the
// rename cascade. Documents mostly store the item NAME (the demo links by id), and the
// stock core (lib/stock/sources.ts) matches those names to the catalog with fin_key(),
// so a rename has to be carried into every document in the same transaction or the
// item's stock history would detach.
//
// Full list (KNOWN_REFS; columns are used only while they exist, discovered from
// information_schema on every call because most tables are created lazily):
//   JSON TEXT arrays (element field "product", by name):
//     supplier_incomings.items, supplier_returns.items, suppliers.products ("Добавить продукт"
//     reserve lines)
//   JSON TEXT arrays whose lines may carry the catalog key "product:<id>" / "raw_material:<id>"
//   (a keyed line follows its item, an unkeyed one goes by name): write_offs.items,
//     internal_transfers.items, internal_transfer_logs.items (history snapshot),
//     repricings.items (field "product"), production_inventories.lines (field "name")
//   JSON TEXT array of names: product_restrictions.items (scope = 'products') — the older
//     name-based table, only until lib/product-restrictions-repo.ts migrates it; the id-based
//     product_restrictions.product_id is found as an id ref (a hard delete is refused)
//   plain text with an exact companion reference (the name follows the id):
//     order_items.product_name (+ product_id), production_movements / production_recipes /
//     production_recipe_items.item_name (+ item_kind, item_id), stock_inventory_items.item_name
//     (+ item_key "product:<id>" / "name:<key>"), inventory_items.inventory_type (+ product_id),
//     inventory_item_requests.product (+ product_id)
//   plain text by name only: price_list_entries.product
//   by id only: net_cost_entries (manual costs of "Себестоимость")
//   id only (block a hard delete; nothing to rename): invoice_incoming_items.product_id /
//     raw_material_id, repricings.product_id
//   any other table: text columns product / product_name / item_name (by name), TEXT columns
//     items / lines / products (JSON, element field "product"), integer product_id /
//     raw_material_id (by id).
// Deliberately not rewritten as a reference: invoice_incoming_items.name (the supplier's
// e-invoice text, linked by id), orders.product (summary generated from order_items: after a
// rename it is REBUILT from the renamed order_items of the affected orders, the way
// lib/order-items-repo.ts writes it, "<name> x<qty>, …"), supplier_incoming_logs.details (free text).
// Name-only references belong to the item that owns the name the way the stock core
// resolves it: the live (not deleted) item with that fin_key, products before raw materials,
// lowest id first. An item that does not own its name (a deleted duplicate) only carries
// its exact (id) references. History tables (*_log / *_logs) follow a rename but never
// block a delete. JSON is rewritten with jsonb functions only where the TEXT is a valid
// JSON array (pg_input_is_valid), element order kept.

type RefType = "text" | "json" | "strings" | "id"

export type CatalogRef = {
  table: string
  column: string
  type: RefType
  /** JSON element field holding the name (json). */
  field?: string
  /** JSON element field holding the catalog key "product:<id>" (production_inventories.lines). */
  keyField?: string
  /** Exact companions in the same row. */
  productId?: string
  itemKind?: string
  itemId?: string
  itemKey?: string
  /** Item kind an id ref points to. */
  idKind?: CatalogKind
  /** Extra SQL filter of the rows (constant, no parameters). */
  where?: string
  history: boolean
}

export const KNOWN_REFS: ReadonlyArray<Omit<CatalogRef, "history">> = [
  { table: "supplier_incomings", column: "items", type: "json", field: "product" },
  { table: "supplier_returns", column: "items", type: "json", field: "product" },
  { table: "write_offs", column: "items", type: "json", field: "product", keyField: "key" },
  { table: "internal_transfers", column: "items", type: "json", field: "product", keyField: "key" },
  { table: "internal_transfer_logs", column: "items", type: "json", field: "product", keyField: "key" },
  { table: "suppliers", column: "products", type: "json", field: "product" },
  { table: "production_inventories", column: "lines", type: "json", field: "name", keyField: "key" },
  { table: "product_restrictions", column: "items", type: "strings", where: "scope = 'products'" },
  { table: "order_items", column: "product_name", type: "text", productId: "product_id" },
  { table: "production_movements", column: "item_name", type: "text", itemKind: "item_kind", itemId: "item_id" },
  { table: "production_recipes", column: "item_name", type: "text", itemKind: "item_kind", itemId: "item_id" },
  { table: "production_recipe_items", column: "item_name", type: "text", itemKind: "item_kind", itemId: "item_id" },
  { table: "stock_inventory_items", column: "item_name", type: "text", itemKey: "item_key" },
  { table: "inventory_items", column: "inventory_type", type: "text", productId: "product_id" },
  { table: "inventory_item_requests", column: "product", type: "text", productId: "product_id" },
  { table: "price_list_entries", column: "product", type: "text" },
  { table: "net_cost_entries", column: "product_id", type: "id", idKind: "product" },
  { table: "net_cost_entries", column: "raw_material_id", type: "id", idKind: "raw_material" },
  { table: "invoice_incoming_items", column: "product_id", type: "id", idKind: "product" },
  { table: "invoice_incoming_items", column: "raw_material_id", type: "id", idKind: "raw_material" },
  { table: "repricings", column: "items", type: "json", field: "product", keyField: "key" },
  { table: "repricings", column: "product_id", type: "id", idKind: "product" },
]

/** Columns that look like references but are not (see the header). */
const NOT_REFS = new Set(["invoice_incoming_items.name", "orders.product", "supplier_incoming_logs.details"])
const OWN_TABLES = new Set(["products", "raw_materials", "product_images", "product_limits"])

/** Section labels (Russian i18n keys) of the referencing tables. */
const TABLE_LABELS: Record<string, string> = {
  supplier_incomings: "Приход от поставщика",
  supplier_returns: "Возврат поставщику",
  write_offs: "Списание",
  internal_transfers: "Передачи между складами",
  suppliers: "Поставщики",
  production_inventories: "Инвентаризация производства",
  production_movements: "Производство",
  production_recipes: "Рецепты",
  production_recipe_items: "Рецепты",
  product_restrictions: "Ограничение продуктов",
  order_items: "Заказы",
  client_returns: "Возвраты",
  client_return_items: "Возвраты",
  stock_inventory_items: "Инвентаризация",
  inventory_items: "Работа с инвентарем",
  inventory_item_requests: "Заявки по инвентарю",
  price_list_entries: "Прайс-листы",
  net_cost_entries: "Себестоимость",
  invoice_incoming_items: "Входящие счета-фактуры",
  repricings: "Переоценка",
}

export function catalogRefLabel(table: string): string {
  return usageTableLabel(table, TABLE_LABELS)
}

const isHistoryTable = (table: string) => /_logs?$/.test(table)

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Referencing columns that exist right now (known ones first, then any other match). */
export async function catalogReferenceColumns(db: PgDb): Promise<CatalogRef[]> {
  const rows = (await db
    .prepare(
      `SELECT c.table_name, c.column_name, c.data_type
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE'`,
    )
    .all()) as Array<{ table_name: string; column_name: string; data_type: string }>
  const columns = new Map<string, Map<string, string>>()
  for (const row of rows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Map())
    columns.get(row.table_name)!.set(row.column_name, row.data_type)
  }
  const has = (table: string, column?: string) => (column ? Boolean(columns.get(table)?.has(column)) : true)
  const textual = (type: string | undefined) => type === "text" || type === "character varying"
  const integer = (type: string | undefined) => type === "integer" || type === "bigint" || type === "smallint"

  const refs: CatalogRef[] = []
  const seen = new Set<string>()
  for (const known of KNOWN_REFS) {
    // Companion columns are part of the known ref (not separate id refs).
    for (const column of [known.column, known.productId, known.itemId, known.itemKey]) if (column) seen.add(`${known.table}.${column}`)
    if (!has(known.table, known.column)) continue
    // Companion columns are used only when they exist too.
    const ref: CatalogRef = { ...known, history: isHistoryTable(known.table) }
    if (ref.productId && !has(ref.table, ref.productId)) delete ref.productId
    if ((ref.itemKind || ref.itemId) && !(has(ref.table, ref.itemKind) && has(ref.table, ref.itemId))) {
      delete ref.itemKind
      delete ref.itemId
    }
    if (ref.itemKey && !has(ref.table, ref.itemKey)) delete ref.itemKey
    if (ref.where && ref.table === "product_restrictions" && !has(ref.table, "scope")) delete ref.where
    refs.push(ref)
  }
  for (const [table, tableColumns] of columns) {
    if (OWN_TABLES.has(table)) continue
    for (const [column, type] of tableColumns) {
      const id = `${table}.${column}`
      if (seen.has(id) || NOT_REFS.has(id)) continue
      const history = isHistoryTable(table)
      if (textual(type) && ["product", "product_name", "item_name"].includes(column)) {
        const productId = integer(tableColumns.get("product_id")) ? "product_id" : undefined
        if (productId) seen.add(`${table}.${productId}`)
        refs.push({ table, column, type: "text", history, ...(productId ? { productId } : {}) })
      } else if (textual(type) && ["items", "lines", "products"].includes(column)) {
        refs.push({ table, column, type: "json", field: "product", history })
      } else if (integer(type) && column === "product_id" && !textual(tableColumns.get("product")) && !textual(tableColumns.get("product_name"))) {
        refs.push({ table, column, type: "id", idKind: "product", history })
      } else if (integer(type) && column === "raw_material_id") {
        refs.push({ table, column, type: "id", idKind: "raw_material", history })
      }
    }
  }
  return refs
}

// --- SQL of one reference --------------------------------------------------------------------
// Parameters: @kind (item kind), @id, @itemKey ("<kind>:<id>"), @old (name), @new (new name),
// @owns (whether the item owns name-only references).

/** The column parsed as a JSON array ('[]' when blank, invalid or not an array). */
function jsonArray(column: string): string {
  return `COALESCE(CASE WHEN pg_input_is_valid(${column}, 'jsonb') THEN CASE WHEN jsonb_typeof(${column}::jsonb) = 'array' THEN ${column}::jsonb END END, '[]'::jsonb)`
}

/** Rows of a text ref that point at the item (exact companion, else owned name). */
function textMatch(ref: CatalogRef): string {
  const column = q(ref.column)
  const byName = `(@owns::boolean AND fin_key(${column}) = fin_key(@old::text))`
  if (ref.productId) {
    const p = q(ref.productId)
    return `((@kind::text = 'product' AND ${p} = @id::integer) OR (${p} IS NULL AND ${byName}))`
  }
  if (ref.itemKind && ref.itemId) {
    const k = q(ref.itemKind)
    const i = q(ref.itemId)
    const exact = `(${k} IN ('product', 'raw_material') AND ${i} IS NOT NULL)`
    return `((${k} = @kind::text AND ${i} = @id::integer) OR (NOT COALESCE(${exact}, false) AND ${byName}))`
  }
  if (ref.itemKey) {
    const key = q(ref.itemKey)
    const exact = `(COALESCE(${key}, '') LIKE 'product:%' OR COALESCE(${key}, '') LIKE 'raw_material:%')`
    return `(${key} = @itemKey::text OR (NOT ${exact} AND ${byName}))`
  }
  return byName
}

/** JSON elements `e` of a json ref that point at the item. */
function elementMatch(ref: CatalogRef): string {
  if (ref.type === "strings") return `(jsonb_typeof(e) = 'string' AND @owns::boolean AND fin_key(e #>> '{}') = fin_key(@old::text))`
  const field = `(e ->> '${ref.field}')`
  const byName = `(@owns::boolean AND jsonb_typeof(e -> '${ref.field}') = 'string' AND fin_key(${field}) = fin_key(@old::text))`
  if (ref.keyField) {
    const key = `COALESCE(e ->> '${ref.keyField}', '')`
    return `(jsonb_typeof(e) = 'object' AND (${key} = @itemKey::text OR (NOT (${key} LIKE 'product:%' OR ${key} LIKE 'raw_material:%') AND ${byName})))`
  }
  return `(jsonb_typeof(e) = 'object' AND ${byName})`
}

function rowFilter(ref: CatalogRef): string {
  return ref.where ? `(${ref.where}) AND ` : ""
}

function usageCondition(ref: CatalogRef): string | null {
  if (ref.type === "id") return null
  if (ref.type === "text") return textMatch(ref)
  return `EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonArray(q(ref.column))}) AS x(e) WHERE ${elementMatch(ref)})`
}

/** True when name-only references of `oldName` belong to this item (see the header). */
export async function catalogOwnsName(db: PgDb, kind: CatalogKind, id: number, name: string, deleted: boolean): Promise<boolean> {
  const rank = kind === "product" ? 0 : 1
  const row = await db
    .prepare(
      `SELECT 1 AS hit FROM (
         SELECT 0 AS pri, id FROM products WHERE fin_key(name) = fin_key(@name) AND COALESCE(deleted, 0) = 0
         UNION ALL
         SELECT 1, id FROM raw_materials WHERE fin_key(name) = fin_key(@name) AND COALESCE(deleted, 0) = 0
       ) o
       WHERE NOT (o.pri = @rank AND o.id = @id) AND (@deleted::boolean OR (o.pri, o.id) < (@rank::integer, @id::integer))
       LIMIT 1`,
    )
    .get({ name, rank, id, deleted })
  return !row
}

/** Document rows that reference the item, per table (history tables skipped). */
export async function catalogUsage(db: PgDb, item: { kind: CatalogKind; id: number; name: string; deleted: boolean }): Promise<CatalogUsage[]> {
  const owns = await catalogOwnsName(db, item.kind, item.id, item.name, item.deleted)
  const params = { kind: item.kind, id: item.id, itemKey: `${item.kind}:${item.id}`, old: item.name, owns }
  const counts = new Map<string, number>()
  for (const ref of await catalogReferenceColumns(db)) {
    if (ref.history) continue
    let sql: string
    if (ref.type === "id") {
      if (ref.idKind !== item.kind) continue
      sql = `SELECT COUNT(*) AS n FROM ${q(ref.table)} WHERE ${q(ref.column)} = @id::integer`
    } else {
      sql = `SELECT COUNT(*) AS n FROM ${q(ref.table)} WHERE ${rowFilter(ref)}${usageCondition(ref)}`
    }
    const row = (await db.prepare(sql).get(params)) as { n: string | number } | undefined
    const count = Number(row?.n ?? 0)
    if (count > 0) counts.set(ref.table, (counts.get(ref.table) ?? 0) + count)
  }
  return [...counts].map(([table, count]) => ({ table, label: catalogRefLabel(table), count }))
}

export type CatalogRenameChange = { table: string; column: string; rows: number }

/** orders.product of the given orders rebuilt from their order_items (same text as lib/order-items-repo.ts). */
async function rebuildOrderSummaries(db: PgDb, orderIds: number[]): Promise<number> {
  if (!orderIds.length) return 0
  const columns = (await db
    .prepare(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND ((table_name = 'orders' AND column_name = 'product') OR (table_name = 'order_items' AND column_name IN ('order_id', 'quantity')))`,
    )
    .all()) as Array<{ table_name: string; column_name: string }>
  if (columns.length < 3) return 0
  const items = (await db
    .prepare("SELECT order_id, product_name, quantity FROM order_items WHERE order_id = ANY(@ids::int[]) ORDER BY order_id, id")
    .all({ ids: orderIds })) as Array<{ order_id: number; product_name: string; quantity: number | string }>
  const summaries = new Map<number, string[]>()
  for (const item of items) {
    const id = Number(item.order_id)
    summaries.set(id, [...(summaries.get(id) ?? []), `${item.product_name} x${Number(item.quantity)}`])
  }
  let rows = 0
  for (const [id, parts] of summaries) {
    const product = parts.join(", ")
    rows += (await db.prepare("UPDATE orders SET product = @product WHERE id = @id AND product IS DISTINCT FROM @product").run({ id, product })).changes
  }
  return rows
}

/**
 * Rewrites every reference of the item from `oldName` to `newName` (exact new spelling).
 * Run it inside the transaction that renames the item row, before the row update.
 */
export async function cascadeCatalogRename(db: PgDb, item: { kind: CatalogKind; id: number; deleted: boolean }, oldName: string, newName: string): Promise<CatalogRenameChange[]> {
  const owns = await catalogOwnsName(db, item.kind, item.id, oldName, item.deleted)
  const params = { kind: item.kind, id: item.id, itemKey: `${item.kind}:${item.id}`, old: oldName, new: newName, owns }
  const changes: CatalogRenameChange[] = []
  const record = (ref: CatalogRef, column: string, rows: number) => {
    if (rows > 0) changes.push({ table: ref.table, column, rows })
  }
  for (const ref of await catalogReferenceColumns(db)) {
    const table = q(ref.table)
    const column = q(ref.column)
    if (ref.type === "id") continue
    if (ref.type === "text") {
      // Orders whose lines are the item: their summary text (orders list, "Товар" filter) follows.
      const orderIds =
        ref.table === "order_items"
          ? ((await db.prepare(`SELECT DISTINCT order_id FROM ${table} WHERE ${textMatch(ref)} AND order_id IS NOT NULL`).all(params)) as Array<{ order_id: number }>).map(
              (row) => Number(row.order_id),
            )
          : []
      const result = await db.prepare(`UPDATE ${table} SET ${column} = @new::text WHERE ${rowFilter(ref)}${textMatch(ref)} AND ${column} IS DISTINCT FROM @new::text`).run(params)
      record(ref, ref.column, result.changes)
      if (orderIds.length) {
        const rows = await rebuildOrderSummaries(db, orderIds)
        if (rows > 0) changes.push({ table: "orders", column: "product", rows })
      }
      if (ref.itemKey && owns) {
        // Lines counted while the name matched no catalog item keep a "name:<key>" key.
        const keys = await db
          .prepare(
            `UPDATE ${table} SET ${q(ref.itemKey)} = 'name:' || fin_key(@new::text) WHERE ${q(ref.itemKey)} = 'name:' || fin_key(@old::text) AND fin_key(@old::text) <> fin_key(@new::text)`,
          )
          .run(params)
        record(ref, ref.itemKey, keys.changes)
      }
      continue
    }
    const match = elementMatch(ref)
    let replacement = `to_jsonb(@new::text)`
    if (ref.type === "json") {
      const setName = `jsonb_set(e, '{${ref.field}}', to_jsonb(@new::text))`
      replacement = ref.keyField
        ? `CASE WHEN COALESCE(e ->> '${ref.keyField}', '') = 'name:' || fin_key(@old::text) THEN jsonb_set(${setName}, '{${ref.keyField}}', to_jsonb('name:' || fin_key(@new::text))) ELSE ${setName} END`
        : setName
    }
    const changed = ref.type === "strings" ? `(e #>> '{}') IS DISTINCT FROM @new::text` : `(e ->> '${ref.field}') IS DISTINCT FROM @new::text`
    const result = await db
      .prepare(
        `UPDATE ${table} SET ${column} = (
           SELECT jsonb_agg(CASE WHEN ${match} THEN ${replacement} ELSE e END ORDER BY o)
             FROM jsonb_array_elements(${jsonArray(column)}) WITH ORDINALITY AS x(e, o)
         )::text
         WHERE ${rowFilter(ref)}EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonArray(column)}) AS x(e) WHERE ${match} AND ${changed})`,
      )
      .run(params)
    record(ref, ref.column, result.changes)
  }
  return changes
}
