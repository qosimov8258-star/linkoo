import "server-only"

import type { PgDb } from "@/lib/db"
import type { WarehouseUsage } from "@/components/analytics/warehouses-data"
import { usageTableLabel } from "@/lib/usage-labels"

// Where warehouses are referenced. Documents store the warehouse NAME as text
// (the demo links them by id), so a rename has to be carried over and a delete
// has to look for the name. The columns are discovered from information_schema
// on every call, because most of these tables are created lazily by their own
// modules (and other modules may add more):
//   * text columns named `warehouse` or `*_warehouse` (from_warehouse, to_warehouse, …)
//     in any base table except `warehouses` itself  → matched by fin_key(name);
//   * integer columns named `warehouse_id` or `*_warehouse_id`        → matched by id
//     (they follow the row on a rename; they only block a delete).
// Known today (see KNOWN_REFERENCES): supplier_incomings.warehouse, supplier_returns.warehouse,
// write_offs.warehouse, internal_transfers.from_warehouse / to_warehouse, production_stages,
// production_movements, production_inventories, production_parties, stock_inventories, orders
// (added lazily by the stock core), client_returns, inventory_items and net_cost_entries
// (lazy) — all `.warehouse` — plus the
// history tables internal_transfer_logs.from_warehouse / to_warehouse and
// inventory_item_logs.warehouse. History (`*_log` / `*_logs`) tables follow a rename but do
// not block a delete: they only describe documents, which are checked themselves.
// Names are matched like the stock core groups them: fin_key() = lower-case, trimmed,
// whitespace collapsed (NBSP / narrow NBSP count as spaces).

export type WarehouseReference = { table: string; column: string; kind: "name" | "id"; history: boolean }

/** Known referencing columns (documentation + labels); each one is used only while it exists. */
export const KNOWN_REFERENCES: ReadonlyArray<{ table: string; column: string }> = [
  { table: "supplier_incomings", column: "warehouse" },
  { table: "supplier_returns", column: "warehouse" },
  { table: "write_offs", column: "warehouse" },
  { table: "internal_transfers", column: "from_warehouse" },
  { table: "internal_transfers", column: "to_warehouse" },
  { table: "production_stages", column: "warehouse" },
  { table: "production_movements", column: "warehouse" },
  { table: "production_inventories", column: "warehouse" },
  { table: "production_parties", column: "warehouse" },
  { table: "stock_inventories", column: "warehouse" },
  { table: "orders", column: "warehouse" },
  { table: "client_returns", column: "warehouse" },
  { table: "inventory_items", column: "warehouse" },
  { table: "net_cost_entries", column: "warehouse" },
  { table: "internal_transfer_logs", column: "from_warehouse" },
  { table: "internal_transfer_logs", column: "to_warehouse" },
  { table: "inventory_item_logs", column: "warehouse" },
]

/** Section labels (Russian i18n keys) of the referencing tables. */
const TABLE_LABELS: Record<string, string> = {
  supplier_incomings: "Приход от поставщика",
  supplier_returns: "Возврат поставщику",
  write_offs: "Списание",
  internal_transfers: "Передачи между складами",
  production_stages: "Этапы производства",
  production_movements: "Производство",
  production_inventories: "Инвентаризация производства",
  production_parties: "Партии",
  stock_inventories: "Инвентаризация",
  orders: "Заказы",
  client_returns: "Возвраты",
  inventory_items: "Работа с инвентарем",
  net_cost_entries: "Себестоимость",
}

export function warehouseReferenceLabel(table: string): string {
  return usageTableLabel(table, TABLE_LABELS)
}

const isHistoryTable = (table: string) => /_logs?$/.test(table)

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** Referencing columns that exist right now (known ones first, then any other match). */
export async function warehouseReferenceColumns(db: PgDb): Promise<WarehouseReference[]> {
  const rows = (await db
    .prepare(
      `SELECT c.table_name, c.column_name, c.data_type
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = current_schema() AND t.table_type = 'BASE TABLE' AND c.table_name <> 'warehouses'
          AND (c.column_name IN ('warehouse', 'warehouse_id') OR c.column_name LIKE '%\\_warehouse' OR c.column_name LIKE '%\\_warehouse\\_id')
        ORDER BY c.table_name, c.column_name`,
    )
    .all()) as Array<{ table_name: string; column_name: string; data_type: string }>
  const textual = new Set(["text", "character varying"])
  const integer = new Set(["integer", "bigint", "smallint"])
  const found: WarehouseReference[] = []
  for (const row of rows) {
    const isId = row.column_name.endsWith("_id")
    const history = isHistoryTable(row.table_name)
    if (isId && integer.has(row.data_type)) found.push({ table: row.table_name, column: row.column_name, kind: "id", history })
    else if (!isId && textual.has(row.data_type)) found.push({ table: row.table_name, column: row.column_name, kind: "name", history })
  }
  const rank = (ref: WarehouseReference) => {
    const index = KNOWN_REFERENCES.findIndex((known) => known.table === ref.table && known.column === ref.column)
    return index < 0 ? KNOWN_REFERENCES.length : index
  }
  return found.sort((a, b) => rank(a) - rank(b) || a.table.localeCompare(b.table) || a.column.localeCompare(b.column))
}

/** Document rows that reference the warehouse, per table (fin_key(name) match or id match; history tables skipped). */
export async function warehouseUsage(db: PgDb, warehouse: { id: number; name: string }, refs?: WarehouseReference[]): Promise<WarehouseUsage[]> {
  const columns = refs ?? (await warehouseReferenceColumns(db))
  const byTable = new Map<string, WarehouseReference[]>()
  for (const ref of columns) if (!ref.history) byTable.set(ref.table, [...(byTable.get(ref.table) ?? []), ref])
  const usage: WarehouseUsage[] = []
  for (const [table, tableRefs] of byTable) {
    const conditions = tableRefs.map((ref) => (ref.kind === "id" ? `${quoteIdent(ref.column)} = @id` : `fin_key(${quoteIdent(ref.column)}) = fin_key(@name)`))
    const row = (await db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)} WHERE ${conditions.join(" OR ")}`).get({ id: warehouse.id, name: warehouse.name })) as
      | { n: string | number }
      | undefined
    const count = Number(row?.n ?? 0)
    if (count > 0) usage.push({ table, label: warehouseReferenceLabel(table), count })
  }
  return usage
}

export type WarehouseRenameChange = { table: string; column: string; rows: number }

/** JS twin of fin_key(). */
function nameKey(value: string): string {
  return value.replace(/[\u00a0\u202f]/g, " ").replace(/\s+/g, " ").trim().toLowerCase()
}

/**
 * Waits for the stock-changing documents of these warehouses that are being written right
 * now, so none of them lands with the old name after the rename: the same transaction-scoped
 * advisory locks as the transfer / write-off writes (lib/internal-transfers-stock.ts
 * lockWarehouseStock, "linko-stock:<key>") and the inventory confirm ("stock_inventory:<key>").
 * Sorted, like lockWarehouseStock, so two writers never wait on each other in a cycle.
 */
export async function lockWarehouseNames(db: PgDb, names: string[]): Promise<void> {
  const keys = [...new Set(names.map(nameKey).filter(Boolean))].sort()
  for (const prefix of ["linko-stock:", "stock_inventory:"]) {
    for (const key of keys) await db.prepare("SELECT pg_advisory_xact_lock(hashtext(@k)) AS ok").get({ k: `${prefix}${key}` })
  }
}

/**
 * Points every text reference of `oldName` (by fin_key) at `newName` (exact new
 * spelling). Run it inside the transaction that renames the warehouse row.
 */
export async function cascadeWarehouseRename(db: PgDb, oldName: string, newName: string): Promise<WarehouseRenameChange[]> {
  const changes: WarehouseRenameChange[] = []
  for (const ref of await warehouseReferenceColumns(db)) {
    if (ref.kind !== "name") continue
    const column = quoteIdent(ref.column)
    const result = await db
      .prepare(`UPDATE ${quoteIdent(ref.table)} SET ${column} = @newName WHERE fin_key(${column}) = fin_key(@oldName) AND ${column} IS DISTINCT FROM @newName`)
      .run({ newName, oldName })
    if (result.changes > 0) changes.push({ table: ref.table, column: ref.column, rows: result.changes })
  }
  return changes
}
