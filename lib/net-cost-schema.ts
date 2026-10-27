import "server-only"

import { getDb, outsideTransaction } from "@/lib/db"
import { ensureFinanceSchema } from "@/lib/finance/schema"

// Tables of "Себестоимость" (lazy, idempotent):
//   net_cost_entries  manual cost entries ("Добавить себестоимость", Excel import) — user data.
//                     product_id / raw_material_id are the catalog references (the catalog's
//                     delete check finds them by id), warehouse '' = "Общий" (the warehouse
//                     rename cascade finds the column by name). entered_at = the local moment
//                     ("YYYY-MM-DDTHH:mm:ss.mmm") it was entered (re-set when its date or
//                     warehouse change; a new cost keeps it); an entry entered on its own day
//                     applies from that moment (lib/net-cost-ledger.ts). NULL on older rows:
//                     they keep the "from the start of the day" rule they were entered under.
//   net_cost_records  the cost records computed from the stock core's movements + the entries
//                     (a cache: rebuilt whenever its sources change, ids kept by natural key).
//                     Column names avoid the catalog / warehouse reference conventions
//                     (product, item_name, warehouse, …) on purpose: it holds no references.
//   net_cost_state    one row: the sources' fingerprint, build time and the header totals.

// v3: install() skips the DDL when the schema is current (no table locks).
const NET_COST_SCHEMA_VERSION = 3

declare global {
  var __linkoNetCostSchema: { version: number; ready: Promise<void> } | undefined
}

// Every object the DDL below creates; when all of them exist the schema is current.
const CURRENT_SCHEMA_PROBE = `SELECT (
  to_regclass('net_cost_entries') IS NOT NULL AND to_regclass('net_cost_records') IS NOT NULL
  AND to_regclass('net_cost_state') IS NOT NULL
  AND to_regclass('net_cost_entries_product_idx') IS NOT NULL AND to_regclass('net_cost_entries_raw_idx') IS NOT NULL
  AND to_regclass('net_cost_records_item_idx') IS NOT NULL AND to_regclass('net_cost_records_day_idx') IS NOT NULL
  AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = 'net_cost_entries' AND column_name = 'entered_at')
) AS ok`

async function install(): Promise<void> {
  const db = getDb()
  await ensureFinanceSchema(db)
  // A current schema (every process start but the first) runs no DDL at all. ALTER TABLE …
  // ADD COLUMN IF NOT EXISTS takes an ACCESS EXCLUSIVE lock and CREATE INDEX IF NOT EXISTS a
  // SHARE lock even when there is nothing to do, and this runs on its own pool connection
  // while the caller may be inside a transaction that already read net_cost_entries: the
  // DDL would wait for that transaction and the transaction for this install, a hang
  // Postgres cannot detect (it froze the whole server once).
  const probe = (await db.prepare(CURRENT_SCHEMA_PROBE).get()) as { ok: boolean } | undefined
  if (probe?.ok) {
    await db.exec("INSERT INTO net_cost_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING")
    return
  }
  // One implicit transaction: the lock keeps concurrent workers from racing on the DDL.
  // lock_timeout: a lock wait fails (and the next call retries, see ensureNetCostSchema)
  // instead of hanging forever.
  await db.exec(`
    SET LOCAL lock_timeout = '10s';
    SELECT pg_advisory_xact_lock(hashtext('linko:net-cost:schema'));
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
    ALTER TABLE net_cost_entries ADD COLUMN IF NOT EXISTS entered_at TEXT;
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
    const ready = outsideTransaction(install).catch((error) => {
      globalThis.__linkoNetCostSchema = undefined
      throw error
    })
    globalThis.__linkoNetCostSchema = { version: NET_COST_SCHEMA_VERSION, ready }
  }
  return globalThis.__linkoNetCostSchema!.ready
}
