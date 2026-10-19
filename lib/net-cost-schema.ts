import "server-only"

import { getDb } from "@/lib/db"
import { ensureFinanceSchema } from "@/lib/finance/schema"

// Tables of "Себестоимость" (lazy, idempotent):
//   net_cost_entries  manual cost entries ("Добавить себестоимость", Excel import) — user data.
//                     product_id / raw_material_id are the catalog references (the catalog's
//                     delete check finds them by id), warehouse '' = "Общий" (the warehouse
//                     rename cascade finds the column by name).
//   net_cost_records  the cost records computed from the stock core's movements + the entries
//                     (a cache: rebuilt whenever its sources change, ids kept by natural key).
//                     Column names avoid the catalog / warehouse reference conventions
//                     (product, item_name, warehouse, …) on purpose: it holds no references.
//   net_cost_state    one row: the sources' fingerprint, build time and the header totals.

const NET_COST_SCHEMA_VERSION = 1

declare global {
  var __linkoNetCostSchema: { version: number; ready: Promise<void> } | undefined
}

async function install(): Promise<void> {
  const db = getDb()
  await ensureFinanceSchema(db)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS net_cost_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      raw_material_id INTEGER,
      item_label TEXT NOT NULL DEFAULT '',
      cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      entry_date TEXT NOT NULL,
      warehouse TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS net_cost_entries_product_idx ON net_cost_entries (product_id);
    CREATE INDEX IF NOT EXISTS net_cost_entries_raw_idx ON net_cost_entries (raw_material_id);

    CREATE TABLE IF NOT EXISTS net_cost_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nk TEXT NOT NULL UNIQUE,
      item_key TEXT NOT NULL,
      item_label TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT '',
      scope_name TEXT NOT NULL DEFAULT '',
      place TEXT NOT NULL DEFAULT '',
      day TEXT NOT NULL,
      at TEXT NOT NULL DEFAULT '',
      seq INTEGER NOT NULL DEFAULT 0,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      entry_id INTEGER,
      qty DOUBLE PRECISION NOT NULL DEFAULT 0,
      real_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      prev_cost DOUBLE PRECISION,
      balance DOUBLE PRECISION NOT NULL DEFAULT 0,
      balance_after DOUBLE PRECISION NOT NULL DEFAULT 0,
      revaluation DOUBLE PRECISION,
      total_revaluation DOUBLE PRECISION,
      balance_ok INTEGER NOT NULL DEFAULT 1,
      negative_ok INTEGER NOT NULL DEFAULT 1,
      timelapse_ok INTEGER NOT NULL DEFAULT 1,
      is_current INTEGER NOT NULL DEFAULT 0,
      next_day TEXT,
      negatives TEXT NOT NULL DEFAULT '[]',
      sig TEXT NOT NULL DEFAULT '',
      last_check_time TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS net_cost_records_item_idx ON net_cost_records (item_key, scope, seq);
    CREATE INDEX IF NOT EXISTS net_cost_records_day_idx ON net_cost_records (day, at);

    CREATE TABLE IF NOT EXISTS net_cost_state (
      id INTEGER PRIMARY KEY,
      fingerprint TEXT NOT NULL DEFAULT '',
      built_at TEXT NOT NULL DEFAULT '',
      totals TEXT NOT NULL DEFAULT '[]'
    );
    INSERT INTO net_cost_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  `)
}

/** Creates the tables once per process (and the fin_* SQL helpers they rely on). */
export function ensureNetCostSchema(): Promise<void> {
  if (globalThis.__linkoNetCostSchema?.version !== NET_COST_SCHEMA_VERSION) {
    const ready = install().catch((error) => {
      globalThis.__linkoNetCostSchema = undefined
      throw error
    })
    globalThis.__linkoNetCostSchema = { version: NET_COST_SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoNetCostSchema!.ready
}
