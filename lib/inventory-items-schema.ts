import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { ensureFinanceSchema } from "@/lib/finance/schema"

// DDL of "Работа с инвентарем", created lazily and idempotently once per
// process. inventory_items (created by lib/db.ts) is the equipment table; its
// legacy text columns are reused: client (client name), inventory_type
// (product name), inventory_code (Инвентарный номер), warehouse (warehouse
// name), condition, responsible, attach_date (YYYY-MM-DD of the last movement),
// check_date (local time of the last review), approved (Одобрено). The new
// tables keep the movements, the agents' requests and the reviews.

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
CREATE INDEX IF NOT EXISTS inventory_items_client_idx ON inventory_items (client_id);

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
`

declare global {
  var __linkoInventoryItemsSchema: Promise<void> | undefined
}

async function schemaReady(db: PgDb): Promise<boolean> {
  const row = (await db
    .prepare(
      `SELECT to_regclass('inventory_item_logs') IS NOT NULL AND to_regclass('inventory_item_requests') IS NOT NULL
         AND to_regclass('inventory_item_checks') IS NOT NULL
         AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inventory_items' AND column_name = 'deleted_by') AS ok`,
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
  globalThis.__linkoInventoryItemsSchema ??= createSchema().catch((error: unknown) => {
    globalThis.__linkoInventoryItemsSchema = undefined
    throw error
  })
  return globalThis.__linkoInventoryItemsSchema
}
