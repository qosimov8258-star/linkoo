import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { ensureFinanceSchema } from "@/lib/finance/schema"

// Database plumbing of the stock core:
// - the fin_* SQL helpers (fin_ts / fin_key / fin_cur) come from the finance
//   schema, installed once per process;
// - the only DDL the core does itself is the (schema-only) `orders.warehouse`
//   column: a client order moves stock once it names its warehouse;
// - a cheap per-call catalog lookup of which source tables / columns exist,
//   because several of them are created lazily by their own repos (the
//   stock inventory tables by the "Инвентаризация" module).

const STOCK_SCHEMA_VERSION = 3

/** Every table the stock ledger reads. */
export const STOCK_TABLES = [
  "products",
  "raw_materials",
  "product_kind_overrides",
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
  "receive_task_reference_rows",
  "stock_opening_balances",
  "stock_reserved_adjustments",
  "transfer_reference_items",
  "ref_records",
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
  if (orders?.ok) await db.exec("ALTER TABLE orders ADD COLUMN IF NOT EXISTS warehouse TEXT NOT NULL DEFAULT ''")
  // Registry of demo rows (scripts/demo/*): the receipts history leaves the later compensation receipts out.
  await db.exec("CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text, row_id text, domain text, created_at timestamptz DEFAULT now())")
  // Additive per warehouse starting quantities (the reference's real stock the local documents do not reproduce), made by
  // scripts/demo/apply-parity-stock.mjs; counted as 'opening' movements without any value, so costs are untouched.
  await db.exec("CREATE TABLE IF NOT EXISTS stock_opening_balances (id SERIAL PRIMARY KEY, warehouse TEXT NOT NULL, item_key TEXT NOT NULL, qty DOUBLE PRECISION NOT NULL)")
  // Additive per warehouse reserved quantities the reference shows beyond its documents (items it holds back that the local
  // documents do not reproduce), made by scripts/demo/apply-stock-cols.mjs; counted as "Бронь" only, never as stock movements.
  await db.exec("CREATE TABLE IF NOT EXISTS stock_reserved_adjustments (id SERIAL PRIMARY KEY, warehouse TEXT NOT NULL, item_key TEXT NOT NULL, qty DOUBLE PRECISION NOT NULL)")
  // Additive list of the reference's "Приемка" tasks (customer returns / transfers), filled by scripts/demo/seed-listb-extra.mjs.
  await db.exec(
    "CREATE TABLE IF NOT EXISTS receive_task_reference_rows (id INTEGER PRIMARY KEY, type TEXT NOT NULL, by_name TEXT NOT NULL DEFAULT '', stock_name TEXT NOT NULL DEFAULT '', task_date TEXT NOT NULL DEFAULT '', order_id INTEGER, status TEXT NOT NULL DEFAULT '0')",
  )
}

/** Installs the SQL helpers the ledger needs (once per process). */
export function ensureStockSchema(): Promise<void> {
  if (globalThis.__linkoStockSchema?.version !== STOCK_SCHEMA_VERSION) {
    const ready = install().catch((error) => {
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
