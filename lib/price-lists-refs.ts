import "server-only"

import type { PgDb } from "@/lib/db"
import { priceListKey } from "@/lib/item-prices"
import type { PriceListUsage } from "@/components/analytics/price-lists-data"

// Where price lists are referenced. Like warehouses, most documents store the price-list NAME
// (the demo links by id), so a rename is carried over in the renaming transaction and a delete
// looks for the name. Matching is by fin_key (case, surrounding / repeated spaces ignored).
//   * JSON: products.price_lists[].name and raw_materials.price_lists[].name (the item prices);
//   * text columns named `price_list`, `*_price_list` or `price_list_name` in any base table
//     (discovered from information_schema on every call: branches.price_list,
//     internal_transfers.price_list, supplier_returns.price_list, raw_materials.price_list (the
//     legacy single price list), price_list_entries.price_list, linked_repricings.price_list_name,
//     and whatever other module adds later);
//   * price_lists.linked_list (another list linked to this one, "Связанный прайс лист");
//   * integer columns `price_list_id` / `*_price_list_id` (repricings.price_list_id): they follow
//     the row on a rename and only block a delete.
// History tables (`*_log`, `*_logs`) and the linked-repricing journal follow a rename but do not
// block a delete.

export type PriceListReference = { table: string; column: string; kind: "name" | "id"; history: boolean }

const TABLE_LABELS: Record<string, string> = {
  products: "Продукты",
  raw_materials: "Сырье",
  branches: "Филиалы",
  internal_transfers: "Передачи между складами",
  supplier_returns: "Возврат поставщику",
  price_list_entries: "Прайс-листы",
  price_lists: "Связанный прайс лист",
  repricings: "Переоценка",
}

export function priceListReferenceLabel(table: string): string {
  return TABLE_LABELS[table] ?? table
}

const JOURNAL_TABLES = new Set(["linked_repricings"])
const isHistoryTable = (table: string) => /_logs?$/.test(table) || JOURNAL_TABLES.has(table)

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Referencing text / id columns that exist right now (JSON item prices and linked_list are handled apart). */
export async function priceListReferenceColumns(db: PgDb): Promise<PriceListReference[]> {
  const rows = (await db
    .prepare(
      `SELECT c.table_name, c.column_name, c.data_type
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE' AND c.table_name <> 'price_lists'
          AND (c.column_name IN ('price_list', 'price_list_id', 'price_list_name')
               OR c.column_name LIKE '%\\_price\\_list' OR c.column_name LIKE '%\\_price\\_list\\_id')
        ORDER BY c.table_name, c.column_name`,
    )
    .all()) as Array<{ table_name: string; column_name: string; data_type: string }>
  const textual = new Set(["text", "character varying"])
  const integer = new Set(["integer", "bigint", "smallint"])
  const found: PriceListReference[] = []
  for (const row of rows) {
    const isId = row.column_name.endsWith("_id")
    const history = isHistoryTable(row.table_name)
    if (isId && integer.has(row.data_type)) found.push({ table: row.table_name, column: row.column_name, kind: "id", history })
    else if (!isId && textual.has(row.data_type)) found.push({ table: row.table_name, column: row.column_name, kind: "name", history })
  }
  return found
}

async function tableHasColumn(db: PgDb, table: string, column: string): Promise<boolean> {
  const row = (await db
    .prepare("SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?")
    .get(table, column)) as { ok: number } | undefined
  return Boolean(row)
}

type JsonRow = { id: number; price_lists: string | null }

function jsonEntries(text: string | null): unknown[] | null {
  try {
    const parsed = JSON.parse(text || "[]") as unknown
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function entryName(entry: unknown): string {
  return entry && typeof entry === "object" ? String((entry as { name?: unknown }).name ?? "") : ""
}

/** Items (products / raw materials) that have a price in the list. */
async function itemPriceRows(db: PgDb, table: "products" | "raw_materials", key: string, lock = false): Promise<Array<JsonRow & { entries: unknown[] }>> {
  if (!(await tableHasColumn(db, table, "price_lists"))) return []
  const rows = (await db
    .prepare(`SELECT id, price_lists FROM ${table} WHERE price_lists IS NOT NULL AND price_lists NOT IN ('', '[]') ORDER BY id${lock ? " FOR UPDATE" : ""}`)
    .all()) as JsonRow[]
  const matched: Array<JsonRow & { entries: unknown[] }> = []
  for (const row of rows) {
    const entries = jsonEntries(row.price_lists)
    if (entries && entries.some((entry) => priceListKey(entryName(entry)) === key)) matched.push({ ...row, entries })
  }
  return matched
}

/** Where the price list is used, per table (history / journal tables skipped). */
export async function priceListUsage(db: PgDb, priceList: { id: number; name: string }): Promise<PriceListUsage[]> {
  const key = priceListKey(priceList.name)
  const usage: PriceListUsage[] = []
  const add = (table: string, count: number) => {
    if (count <= 0) return
    const existing = usage.find((item) => item.table === table)
    if (existing) existing.count += count
    else usage.push({ table, label: priceListReferenceLabel(table), count })
  }
  for (const table of ["products", "raw_materials"] as const) add(table, (await itemPriceRows(db, table, key)).length)

  const byTable = new Map<string, PriceListReference[]>()
  for (const ref of await priceListReferenceColumns(db)) if (!ref.history) byTable.set(ref.table, [...(byTable.get(ref.table) ?? []), ref])
  for (const [table, refs] of byTable) {
    const conditions = refs.map((ref) => (ref.kind === "id" ? `${quoteIdent(ref.column)} = @id` : `fin_key(${quoteIdent(ref.column)}) = fin_key(@name)`))
    // A raw material counted through its JSON prices is not counted twice through the legacy column.
    const extra = table === "raw_materials" ? " AND (price_lists IS NULL OR price_lists IN ('', '[]'))" : ""
    const row = (await db
      .prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)} WHERE (${conditions.join(" OR ")})${extra}`)
      .get({ id: priceList.id, name: priceList.name })) as { n: string | number } | undefined
    add(table, Number(row?.n ?? 0))
  }

  const linked = (await db
    .prepare("SELECT COUNT(*) AS n FROM price_lists WHERE id <> @id AND fin_key(linked_list) = fin_key(@name)")
    .get({ id: priceList.id, name: priceList.name })) as { n: string | number } | undefined
  add("price_lists", Number(linked?.n ?? 0))
  return usage
}

export type PriceListRenameChange = { table: string; column: string; rows: number }

/**
 * Points every reference of `oldName` (fin_key) at `newName` (exact new spelling): item price JSON,
 * text columns and price_lists.linked_list. Run it inside the transaction that renames the row.
 */
export async function cascadePriceListRename(db: PgDb, oldName: string, newName: string): Promise<PriceListRenameChange[]> {
  const key = priceListKey(oldName)
  const changes: PriceListRenameChange[] = []
  for (const table of ["products", "raw_materials"] as const) {
    let count = 0
    for (const row of await itemPriceRows(db, table, key, true)) {
      let touched = false
      const entries = row.entries.map((entry) => {
        if (priceListKey(entryName(entry)) !== key || entryName(entry) === newName) return entry
        touched = true
        return { ...(entry as object), name: newName }
      })
      if (!touched) continue
      await db.prepare(`UPDATE ${table} SET price_lists = ? WHERE id = ?`).run(JSON.stringify(entries), row.id)
      count += 1
    }
    if (count) changes.push({ table, column: "price_lists", rows: count })
  }
  for (const ref of await priceListReferenceColumns(db)) {
    if (ref.kind !== "name") continue
    const column = quoteIdent(ref.column)
    const result = await db
      .prepare(`UPDATE ${quoteIdent(ref.table)} SET ${column} = @newName WHERE fin_key(${column}) = fin_key(@oldName) AND ${column} IS DISTINCT FROM @newName`)
      .run({ newName, oldName })
    if (result.changes > 0) changes.push({ table: ref.table, column: ref.column, rows: result.changes })
  }
  const linked = await db
    .prepare("UPDATE price_lists SET linked_list = @newName WHERE fin_key(linked_list) = fin_key(@oldName) AND linked_list IS DISTINCT FROM @newName")
    .run({ newName, oldName })
  if (linked.changes > 0) changes.push({ table: "price_lists", column: "linked_list", rows: linked.changes })
  return changes
}
