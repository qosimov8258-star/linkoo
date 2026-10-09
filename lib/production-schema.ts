import "server-only"

import { getDb, type PgDb } from "@/lib/db"

// Production module tables (Этапы производства / Партии). Mirrors the demo
// Linko data model: a stage ("manufacture") owns a warehouse, its products
// (recipes with raw-material norms), operations, staff and equipment; a
// batch ("party") collects made / raw / defect stock movements for a stage.
// Movements without a batch are the stage's shift activity.

declare global {
  var __linkoProductionSchemaReady: Promise<void> | undefined
}

async function createSchema(db: PgDb) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS production_stages (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      warehouse TEXT NOT NULL DEFAULT '',
      responsible TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS production_equipment (
      id SERIAL PRIMARY KEY,
      stage_id INTEGER NOT NULL REFERENCES production_stages(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '0',
      image TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS production_operations (
      id SERIAL PRIMARY KEY,
      stage_id INTEGER NOT NULL REFERENCES production_stages(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL DEFAULT 'equipment',
      equipment_id INTEGER REFERENCES production_equipment(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS production_staff (
      id SERIAL PRIMARY KEY,
      stage_id INTEGER NOT NULL REFERENCES production_stages(id) ON DELETE CASCADE,
      employee_id INTEGER,
      employee_name TEXT NOT NULL,
      position TEXT NOT NULL DEFAULT '',
      shift TEXT NOT NULL DEFAULT '',
      begin_time TEXT NOT NULL DEFAULT '',
      end_time TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS production_recipes (
      id SERIAL PRIMARY KEY,
      stage_id INTEGER NOT NULL REFERENCES production_stages(id) ON DELETE CASCADE,
      item_kind TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      item_type TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      equipment_id INTEGER REFERENCES production_equipment(id) ON DELETE SET NULL,
      amount DOUBLE PRECISION NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS production_recipe_items (
      id SERIAL PRIMARY KEY,
      recipe_id INTEGER NOT NULL REFERENCES production_recipes(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'raw',
      item_kind TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT '',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS production_parties (
      id SERIAL PRIMARY KEY,
      stage_id INTEGER REFERENCES production_stages(id) ON DELETE SET NULL,
      stage_name TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      user_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS production_movements (
      id SERIAL PRIMARY KEY,
      stage_id INTEGER REFERENCES production_stages(id) ON DELETE SET NULL,
      party_id INTEGER REFERENCES production_parties(id) ON DELETE CASCADE,
      warehouse TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL,
      item_kind TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT '',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      is_defect INTEGER NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      shift TEXT NOT NULL DEFAULT '',
      equipment_id INTEGER REFERENCES production_equipment(id) ON DELETE SET NULL,
      worker TEXT NOT NULL DEFAULT '',
      user_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS production_inventories (
      id SERIAL PRIMARY KEY,
      stage_id INTEGER NOT NULL REFERENCES production_stages(id) ON DELETE CASCADE,
      warehouse TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      user_name TEXT NOT NULL DEFAULT '',
      lines TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS production_movements_party_idx ON production_movements (party_id);
    CREATE INDEX IF NOT EXISTS production_movements_stage_date_idx ON production_movements (stage_id, date);
    CREATE INDEX IF NOT EXISTS production_movements_warehouse_idx ON production_movements (warehouse);
  `)
}

/** Lazily creates the production tables once per process and returns the db. */
export async function getProductionDb(): Promise<PgDb> {
  const db = getDb()
  if (!globalThis.__linkoProductionSchemaReady) {
    globalThis.__linkoProductionSchemaReady = createSchema(db).catch((error) => {
      globalThis.__linkoProductionSchemaReady = undefined
      throw error
    })
  }
  await globalThis.__linkoProductionSchemaReady
  return db
}

export type ItemKind = "product" | "raw_material"

/** Production items reference either a product or a raw material; the
 * client passes them around as a single "kind:id" key. */
export function parseItemKey(key: string): { kind: ItemKind; id: number } | null {
  const [kind, id] = key.split(":")
  const numericId = Number(id)
  if ((kind !== "product" && kind !== "raw_material") || !Number.isInteger(numericId) || numericId <= 0) return null
  return { kind, id: numericId }
}

export function itemKey(kind: string, id: number) {
  return `${kind}:${id}`
}

export function nowIso() {
  return new Date().toISOString()
}

export function round(value: number, digits = 9) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
