import "server-only"

import { getDb, outsideTransaction, type PgDb } from "@/lib/db"
import { ensureFinanceSchema } from "@/lib/finance/schema"

// DDL of "Работа с инвентарем", created lazily and idempotently once per
// process. inventory_items (created by lib/db.ts) is the equipment table; its
// legacy text columns are reused: client (client name), inventory_type
// (product name), inventory_code (Инвентарный номер), warehouse (warehouse
// name), condition, responsible, attach_date (YYYY-MM-DD of the last movement),
// check_date (local time of the last review), approved (Одобрено). The new
// tables keep the movements, the agents' requests, the reviews and the
// conditions. attach_date is Linko's item date as it stands (empty when Linko
// has none: its list then shows the creation day, its card nothing); photo is a
// data URL, or the address of a Linko file that its server no longer serves
// (the card shows the photo frame like Linko's).

const DDL = `
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS product_id INTEGER;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS client_id INTEGER;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS photo TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reviewed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS deleted_at TEXT NOT NULL DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS deleted_by TEXT NOT NULL DEFAULT '';
-- Linko's file id of the photo (its viewer writes openImageDialog=<file id>); NULL for a photo uploaded here.
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS photo_id INTEGER;
CREATE INDEX IF NOT EXISTS inventory_items_client_idx ON inventory_items (client_id);

-- Linko's order of the inventory products in the Продукт select (its server order of stock/all_balances?is_gear=true):
-- id = the product id, position from 1 (scripts/linko-sync/import-gears.mjs).
CREATE TABLE IF NOT EXISTS inventory_product_positions (
  id INTEGER PRIMARY KEY,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_item_logs (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  client_id INTEGER,
  client TEXT NOT NULL DEFAULT '',
  warehouse TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  move_date TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  request_id INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS inventory_item_logs_item_idx ON inventory_item_logs (item_id);

CREATE TABLE IF NOT EXISTS inventory_item_requests (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  client_id INTEGER,
  client TEXT NOT NULL DEFAULT '',
  product_id INTEGER,
  product TEXT NOT NULL DEFAULT '',
  item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  comment TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS inventory_item_requests_status_idx ON inventory_item_requests (status);

CREATE TABLE IF NOT EXISTS inventory_item_checks (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  client_id INTEGER,
  client TEXT NOT NULL DEFAULT '',
  is_reviewed INTEGER NOT NULL DEFAULT 1,
  comment TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS inventory_item_checks_item_idx ON inventory_item_checks (item_id);

-- Rows copied from Linko (scripts/linko-sync/import-gears.mjs) keep its id, so a re-run updates them in place.
ALTER TABLE inventory_item_logs ADD COLUMN IF NOT EXISTS linko_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_logs_linko_idx ON inventory_item_logs (linko_id) WHERE linko_id IS NOT NULL;
ALTER TABLE inventory_item_checks ADD COLUMN IF NOT EXISTS linko_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_checks_linko_idx ON inventory_item_checks (linko_id) WHERE linko_id IS NOT NULL;
-- The review's photos as Linko lists them (JSON [{id, file, file_id}], gear_check images); [] for a review made here.
ALTER TABLE inventory_item_checks ADD COLUMN IF NOT EXISTS images TEXT NOT NULL DEFAULT '[]';

-- Состояние (Linko main/gear_condition): the options of the item forms, in id order. A new database starts with
-- Linko's three default conditions.
CREATE TABLE IF NOT EXISTS inventory_conditions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
INSERT INTO inventory_conditions (name)
  SELECT name FROM unnest(ARRAY['Новый', 'Хороший', 'Старый']) WITH ORDINALITY AS d(name, n)
  WHERE NOT EXISTS (SELECT 1 FROM inventory_conditions) ORDER BY n;
`

declare global {
  var __linkoInventoryItemsSchema: Promise<void> | undefined
}

async function schemaReady(db: PgDb): Promise<boolean> {
  const row = (await db
    .prepare(
      `SELECT to_regclass('inventory_item_logs') IS NOT NULL AND to_regclass('inventory_item_requests') IS NOT NULL
         AND to_regclass('inventory_item_checks') IS NOT NULL AND to_regclass('inventory_conditions') IS NOT NULL
         AND to_regclass('inventory_product_positions') IS NOT NULL
         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_items' AND column_name = 'deleted_by')
         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_items' AND column_name = 'photo_id')
         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_item_checks' AND column_name = 'linko_id')
         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_item_checks' AND column_name = 'images') AS ok`,
    )
    .get()) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

async function createSchema(): Promise<void> {
  const db = getDb()
  // fin_key() / fin_place() are used by the list filters.
  await ensureFinanceSchema(db)
  try {
    await db.exec(DDL)
  } catch (error) {
    // Two processes altering at once: the loser may fail although the schema is complete now.
    if (!(await schemaReady(db))) throw error
  }
}

/** Adds the equipment columns / tables if missing (idempotent, once per process). */
export function ensureInventorySchema(): Promise<void> {
  globalThis.__linkoInventoryItemsSchema ??= outsideTransaction(createSchema).catch((error: unknown) => {
    globalThis.__linkoInventoryItemsSchema = undefined
    throw error
  })
  return globalThis.__linkoInventoryItemsSchema
}
