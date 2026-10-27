import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { ensureFinanceSchema } from "@/lib/finance/schema"

// Database plumbing of the stock core:
// - the fin_* SQL helpers (fin_ts / fin_key / fin_cur) come from the finance
//   schema, installed once per process;
// - the only DDL the core does itself is the (schema-only) `orders.warehouse`
//   column: a client order moves stock once it names its warehouse;
// - a cheap per-call catalog lookup of which source tables / columns exist,
//   because several of them are created lazily by their own repos (the
//   stock inventory tables by the "Инвентаризация" module).

const STOCK_SCHEMA_VERSION = 1

/** Every table the stock ledger reads. */
export const STOCK_TABLES = [
  "products",
  "raw_materials",
  "warehouses",
  "currencies",
  "supplier_incomings",
  "supplier_incoming_expenses",
  "supplier_returns",
  "write_offs",
  "internal_transfers",
  "production_movements",
  "production_parties",
  "orders",
  "order_items",
  "stock_inventories",
  "stock_inventory_items",
  // Client returns (SALES, contract 5): created lazily, read only when present.
  "client_returns",
  "client_return_items",
] as const

export type StockTables = {
  has(table: string): boolean
  col(table: string, column: string): boolean
}

declare global {
  var __linkoStockSchema: { version: number; ready: Promise<void> } | undefined
}

async function install(): Promise<void> {
  // Autocommit connection on purpose: callers may hold a transaction (the
  // production repos call the core inside withTransaction).
  const db = getDb()
  await ensureFinanceSchema(db)
  const orders = (await db.prepare("SELECT to_regclass('orders') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (!orders?.ok) return
  // ADD COLUMN IF NOT EXISTS still takes an ACCESS EXCLUSIVE lock on orders even when
  // the column is there. A caller whose transaction already read orders and then awaits
  // the first ensureStockSchema() of the process would wait on that ALTER while the ALTER
  // waits on it, which Postgres cannot detect. So ALTER only when the column is missing,
  // and give up after a short lock wait instead of hanging every request.
  const column = await db
    .prepare(
      "SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'warehouse'",
    )
    .get()
  if (column) return
  await withTransaction(async (tx) => {
    await tx.exec("SET LOCAL lock_timeout = '5s'")
    await tx.exec("ALTER TABLE orders ADD COLUMN IF NOT EXISTS warehouse TEXT NOT NULL DEFAULT ''")
  })
}

/** Installs the SQL helpers the ledger needs (once per process). */
export function ensureStockSchema(): Promise<void> {
  if (globalThis.__linkoStockSchema?.version !== STOCK_SCHEMA_VERSION) {
    const ready = outsideTransaction(install).catch((error) => {
      globalThis.__linkoStockSchema = undefined
      throw error
    })
    globalThis.__linkoStockSchema = { version: STOCK_SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoStockSchema!.ready
}

/** Which ledger tables / columns exist right now (one pg_catalog query). */
export async function stockTables(db: PgDb = getDb()): Promise<StockTables> {
  await ensureStockSchema()
  const rows = (await db
    .prepare(
      `SELECT c.relname AS t, a.attname AS c
       FROM pg_class c
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE c.relnamespace = current_schema()::regnamespace AND c.relkind IN ('r', 'p', 'v') AND c.relname = ANY(@stk_tables::text[])`,
    )
    .all({ stk_tables: [...STOCK_TABLES] })) as Array<{ t: string; c: string }>
  const map = new Map<string, Set<string>>()
  for (const row of rows) {
    let columns = map.get(row.t)
    if (!columns) map.set(row.t, (columns = new Set()))
    columns.add(row.c)
  }
  return {
    has: (table) => map.has(table),
    col: (table, column) => map.get(table)?.has(column) ?? false,
  }
}
