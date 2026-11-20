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
-- 1 = an inventory imported from Linko, whose differences Linko booked as separate supply / write-off documents
-- (imported with them): the stock ledger does not count its differences again (lib/stock/sources.ts).
ALTER TABLE stock_inventories ADD COLUMN IF NOT EXISTS booked_by_documents INTEGER NOT NULL DEFAULT 0;
-- The line's series (stock_series.id, the shared series catalog of lib/client-returns-series-repo.ts); the series column keeps
-- its display name. NULL = no series.
ALTER TABLE stock_inventory_items ADD COLUMN IF NOT EXISTS series_id INTEGER;
-- Linko's inventory_products[].total_weight / total_weight_netto: the line's difference × the unit's weight / net weight,
-- written when the line is saved (the edit form's «Вес» / «Вес нетто» of a stored line).
ALTER TABLE stock_inventory_items ADD COLUMN IF NOT EXISTS total_weight DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE stock_inventory_items ADD COLUMN IF NOT EXISTS total_weight_netto DOUBLE PRECISION NOT NULL DEFAULT 0;
-- «Удаление» (Linko's DELETE stock/inventory/:id/ {comment}): who deleted which inventory and why, with a copy of it.
CREATE TABLE IF NOT EXISTS stock_inventory_deletions (
  id SERIAL PRIMARY KEY,
  inventory_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  deleted_by TEXT NOT NULL DEFAULT '',
  deleted_at TEXT NOT NULL DEFAULT (datetime('now')),
  document JSONB
);
CREATE INDEX IF NOT EXISTS stock_inventory_items_inventory_idx ON stock_inventory_items (inventory_id);
CREATE INDEX IF NOT EXISTS stock_inventories_status_idx ON stock_inventories (status, warehouse);
`

declare global {
  // Versioned name: a running dev server applies the DDL again after it changes.
  var __linkoStockInventoriesSchemaV3: Promise<void> | undefined
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
  globalThis.__linkoStockInventoriesSchemaV3 ??= outsideTransaction(createSchema).catch((error: unknown) => {
    globalThis.__linkoStockInventoriesSchemaV3 = undefined
    throw error
  })
  return globalThis.__linkoStockInventoriesSchemaV3
}
