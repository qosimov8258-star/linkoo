import "server-only"

import { getDb, outsideTransaction, type PgDb } from "@/lib/db"

// DDL of "Инвентаризация" (scratchpad stock/spec.md, "Inventory tables"),
// created lazily and idempotently once per process. The stock core reads
// these tables only after checking that they exist (to_regclass), so nothing
// else needs them before the first inventory request.

const DDL = `
CREATE TABLE IF NOT EXISTS stock_inventories (
  id SERIAL PRIMARY KEY,
  warehouse TEXT NOT NULL,
  inv_date TEXT NOT NULL,
  for_day_end INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'fact_date',
  status TEXT NOT NULL DEFAULT 'pending',
  comment TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT '',
  total_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT NOT NULL DEFAULT '',
  confirmed_by TEXT NOT NULL DEFAULT '',
  canceled_at TEXT NOT NULL DEFAULT '',
  canceled_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS stock_inventory_items (
  id SERIAL PRIMARY KEY,
  inventory_id INTEGER NOT NULL REFERENCES stock_inventories(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item_name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  amount DOUBLE PRECISION NOT NULL,
  balance_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  diff DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  series TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS stock_inventory_items_inventory_idx ON stock_inventory_items (inventory_id);
CREATE INDEX IF NOT EXISTS stock_inventories_status_idx ON stock_inventories (status, warehouse);
`

declare global {
  var __linkoStockInventoriesSchema: Promise<void> | undefined
}

async function tablesExist(db: PgDb): Promise<boolean> {
  const row = (await db
    .prepare("SELECT to_regclass('stock_inventories') IS NOT NULL AND to_regclass('stock_inventory_items') IS NOT NULL AS ok")
    .get()) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

async function createSchema(): Promise<void> {
  const db = getDb()
  try {
    await db.exec(DDL)
  } catch (error) {
    // Two processes creating the tables at once: the loser fails on the
    // catalog's unique index although the tables are there now.
    if (!(await tablesExist(db))) throw error
  }
}

/** Creates stock_inventories / stock_inventory_items if missing (idempotent, once per process). */
export function ensureStockInventoriesSchema(): Promise<void> {
  globalThis.__linkoStockInventoriesSchema ??= outsideTransaction(createSchema).catch((error: unknown) => {
    globalThis.__linkoStockInventoriesSchema = undefined
    throw error
  })
  return globalThis.__linkoStockInventoriesSchema
}
