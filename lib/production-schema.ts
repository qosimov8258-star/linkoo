import "server-only"

import { getDb, type PgDb } from "@/lib/db"

// Production module tables (Этапы производства / Партии). Mirrors the demo
// Linko data model: a stage ("manufacture") owns a warehouse, its products
// (recipes with raw-material norms), operations, staff and equipment; a
// batch ("party") collects made / raw / defect stock movements for a stage.
// Movements without a batch are the stage's shift activity.

// Bump when createSchema changes, so a running dev server applies the new DDL
// (the ready promise is cached on globalThis across hot reloads).
const PRODUCTION_SCHEMA_VERSION = 3

declare global {
  var __linkoProductionSchema: { version: number; ready: Promise<void> } | undefined
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

    -- v2: a batch keeps the warehouse it was created in (the stage's warehouse
    -- may change later); the stage's responsible is an employee; inventory
    -- adjustments point at their inventory.
    ALTER TABLE production_parties ADD COLUMN IF NOT EXISTS warehouse TEXT NOT NULL DEFAULT '';
    ALTER TABLE production_stages ADD COLUMN IF NOT EXISTS responsible_id INTEGER;
    ALTER TABLE production_movements ADD COLUMN IF NOT EXISTS inventory_id INTEGER;

    -- Money / quantity columns are double precision (older databases may hold real).
    DO $production_types$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND data_type = 'real'
          AND table_name IN ('production_movements', 'production_recipes', 'production_recipe_items')
      LOOP
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE double precision', r.table_name, r.column_name);
      END LOOP;
    END
    $production_types$;

    -- Batches created before v2: the warehouse their stock actually moved in,
    -- else the stage's current one.
    UPDATE production_parties p SET warehouse = COALESCE(
      (SELECT m.warehouse FROM production_movements m WHERE m.party_id = p.id AND m.warehouse <> '' ORDER BY m.id LIMIT 1),
      (SELECT s.warehouse FROM production_stages s WHERE s.id = p.stage_id),
      '')
    WHERE p.warehouse = '';

    -- Output cost (v3): everything the batch consumed (raw incl. spoiled raw)
    -- ÷ its GOOD units; defective output (brak) carries no value, as in the
    -- stock core and the cost ledger. A batch thus moves value from raw
    -- materials to products without creating any. Idempotent repair of
    -- batches costed by older rules (brak valued like good output).
    UPDATE production_movements m SET cost = CASE WHEN m.is_defect = 1 THEN 0 ELSE t.unit END
    FROM (
      SELECT party_id,
        CASE WHEN COALESCE(SUM(amount) FILTER (WHERE direction = 'made' AND is_defect <> 1), 0) > 0
          THEN COALESCE(SUM(amount * cost) FILTER (WHERE direction = 'raw'), 0) / SUM(amount) FILTER (WHERE direction = 'made' AND is_defect <> 1)
          ELSE 0 END AS unit
      FROM production_movements WHERE party_id IS NOT NULL GROUP BY party_id
    ) t
    WHERE m.party_id = t.party_id AND m.direction = 'made'
      AND m.cost IS DISTINCT FROM (CASE WHEN m.is_defect = 1 THEN 0 ELSE t.unit END);
    -- Defective shift output carries no value either.
    UPDATE production_movements SET cost = 0 WHERE party_id IS NULL AND direction = 'made' AND is_defect = 1 AND cost <> 0;
  `)
}

/** Lazily creates / upgrades the production tables once per process and returns the db. */
export async function getProductionDb(): Promise<PgDb> {
  const db = getDb()
  if (globalThis.__linkoProductionSchema?.version !== PRODUCTION_SCHEMA_VERSION) {
    const ready = createSchema(db).catch((error) => {
      globalThis.__linkoProductionSchema = undefined
      throw error
    })
    globalThis.__linkoProductionSchema = { version: PRODUCTION_SCHEMA_VERSION, ready }
  }
  await globalThis.__linkoProductionSchema!.ready
  return db
}

/** A refused production request: HTTP status + message (+ extra JSON fields,
 * e.g. the stock shortages). The API routes turn it into the response. */
export class ProductionError extends Error {
  readonly status: number
  readonly details?: Record<string, unknown>
  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = "ProductionError"
    this.status = status
    this.details = details
  }
}

export function isProductionError(error: unknown): error is ProductionError {
  return error instanceof Error && error.name === "ProductionError" && typeof (error as ProductionError).status === "number"
}

/** JS twin of fin_key(): lower-cased, trimmed, inner whitespace collapsed (NBSP counts as a space). */
export function textKey(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
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
