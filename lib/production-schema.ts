import "server-only"

import { getDb, outsideTransaction, type PgDb } from "@/lib/db"

// Production module tables (Этапы производства / Партии). Mirrors the demo
// Linko data model: a stage ("manufacture") owns a warehouse, its products
// (recipes with raw-material norms), operations, staff and equipment; a
// batch ("party") collects made / raw / defect stock movements for a stage.
// Movements without a batch are the stage's shift activity.

// Bump when createSchema changes, so a running dev server applies the new DDL
// (the ready promise is cached on globalThis across hot reloads).
const PRODUCTION_SCHEMA_VERSION = 10

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
    -- v4: a shift entry's output keeps the recipe norms it was costed with (JSON
    -- [{key, amount per unit of output}]), so the cost ledger values it at the
    -- components' current averages of its day (lib/net-cost-sync.ts). NULL on older
    -- rows (they keep their stored cost) and on every other line.
    ALTER TABLE production_movements ADD COLUMN IF NOT EXISTS cost_basis TEXT;
    -- 0 = a batch line imported from Linko that Linko shows on the batch but never booked into the stock
    -- (its stock history has no movement for it): the stock ledger leaves it out (lib/stock/sources.ts).
    ALTER TABLE production_movements ADD COLUMN IF NOT EXISTS in_stock INTEGER NOT NULL DEFAULT 1;

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

    -- Output cost (v3, COST B3-02 / B5-01): the batch good raw (spoiled raw,
    -- Бракованное сырье, excluded) ÷ its GOOD units, exactly as recalcPartyCost
    -- in lib/production-batches-repo.ts. Spoiled raw leaves the stock but is no
    -- part of the output value; defective output (brak) carries no value, as in
    -- the stock core and the cost ledger. Idempotent repair of batches costed by
    -- older rules (brak valued like good output, spoiled raw in the output value).
    UPDATE production_movements m SET cost = CASE WHEN m.is_defect = 1 THEN 0 ELSE t.unit END
    FROM (
      SELECT party_id,
        CASE WHEN COALESCE(SUM(amount) FILTER (WHERE direction = 'made' AND is_defect <> 1), 0) > 0
          THEN COALESCE(SUM(amount * cost) FILTER (WHERE direction = 'raw' AND is_defect <> 1), 0) / SUM(amount) FILTER (WHERE direction = 'made' AND is_defect <> 1)
          ELSE 0 END AS unit
      FROM production_movements WHERE party_id IS NOT NULL GROUP BY party_id
    ) t
    WHERE m.party_id = t.party_id AND m.direction = 'made'
      AND m.cost IS DISTINCT FROM (CASE WHEN m.is_defect = 1 THEN 0 ELSE t.unit END);
    -- Defective shift output carries no value either.
    UPDATE production_movements SET cost = 0 WHERE party_id IS NULL AND direction = 'made' AND is_defect = 1 AND cost <> 0;

    -- STAFFEQ (Персонал, Оборудование) -------------------------------------------------------------
    -- A staff row is an employee on a shift of the Смены directory (work_shifts), by id, as Linko's
    -- user_shift {user, shift, manufacture}: the shift's name and times are read from there.
    -- shift / begin_time / end_time keep the copy of the last save (shown only once the shift is gone).
    -- Rows saved with a shift name only (older ones, the Linko copy) are linked once by that name, when
    -- exactly one directory shift carries it.
    ALTER TABLE production_staff ADD COLUMN IF NOT EXISTS shift_id INTEGER;
    CREATE INDEX IF NOT EXISTS production_staff_shift_idx ON production_staff (shift_id);
    -- (The DO blocks look in the catalog first: once current they take no table lock, lib/ddl-skip.ts.)
    DO $staffeq_staff_shift$
    BEGIN
      IF to_regclass('work_shifts') IS NOT NULL
         AND EXISTS (SELECT 1 FROM production_staff WHERE shift_id IS NULL AND btrim(shift) <> '') THEN
        UPDATE production_staff s SET shift_id = w.id
          FROM work_shifts w
         WHERE s.shift_id IS NULL AND btrim(s.shift) <> ''
           AND lower(btrim(w.name)) = lower(btrim(s.shift))
           AND NOT EXISTS (SELECT 1 FROM work_shifts o WHERE o.id <> w.id AND lower(btrim(o.name)) = lower(btrim(s.shift)));
      END IF;
    END
    $staffeq_staff_shift$;
    -- An employee holds a shift once, on any stage (Linko: «Один пользователь может иметь только один раз
    -- в одну смену»). The index is built once the rows obey it (older rows were unique per stage instead);
    -- the repo checks the rule under a lock either way.
    DO $staffeq_staff_unique$
    BEGIN
      IF to_regclass('production_staff_employee_shift_uidx') IS NULL AND NOT EXISTS (
        SELECT 1 FROM production_staff WHERE employee_id IS NOT NULL AND shift_id IS NOT NULL
         GROUP BY employee_id, shift_id HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS production_staff_employee_shift_uidx
          ON production_staff (employee_id, shift_id) WHERE employee_id IS NOT NULL AND shift_id IS NOT NULL;
      END IF;
    END
    $staffeq_staff_unique$;
    -- One equipment directory: Настройки → «Оборудования» kept its machines in a table of its own
    -- (equipment, with manufacturings, a static copy of the stage list), which the stage tabs never saw.
    -- Its machines join production_equipment once, on the stage with the same id (equipment.moved_to and
    -- production_equipment.legacy_id remember the move; the old rows stay). As in Linko, they start
    -- «не работает» (status '0'). A machine without a known stage stays where it was.
    ALTER TABLE production_equipment ADD COLUMN IF NOT EXISTS legacy_id INTEGER;
    DO $staffeq_equipment_merge$
    BEGIN
      IF (SELECT COUNT(*) FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'equipment'
             AND column_name IN ('id', 'name', 'manufacturing_id', 'photo', 'created_at')) = 5 THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = current_schema() AND table_name = 'equipment' AND column_name = 'moved_to') THEN
          ALTER TABLE equipment ADD COLUMN moved_to INTEGER;
        END IF;
        IF EXISTS (SELECT 1 FROM equipment e JOIN production_stages s ON s.id = e.manufacturing_id
                    WHERE e.moved_to IS NULL AND btrim(COALESCE(e.name, '')) <> '') THEN
          WITH moved AS (
            INSERT INTO production_equipment (stage_id, name, status, image, created_at, legacy_id)
            SELECT s.id, btrim(e.name), '0', COALESCE(e.photo, ''), COALESCE(e.created_at, ''), e.id
              FROM equipment e JOIN production_stages s ON s.id = e.manufacturing_id
             WHERE e.moved_to IS NULL AND btrim(COALESCE(e.name, '')) <> ''
            RETURNING id, legacy_id
          )
          UPDATE equipment e SET moved_to = moved.id FROM moved WHERE e.id = moved.legacy_id;
        END IF;
      END IF;
    END
    $staffeq_equipment_merge$;
    -- (end STAFFEQ)

    -- STAGES (Этапы производства, Операции) ---------------------------------------------------------
    -- Operations are global, as in the reference (its operations carry no stage: one list under every
    -- stage, equipment of any stage). New operations have no stage; the stage of an older row is only
    -- where it was filed, and deleting that stage keeps the operation (lib/production-stages-repo.ts
    -- detaches it first). Relaxing NOT NULL keeps every existing value. The ALTER would take the table's
    -- ACCESS EXCLUSIVE lock on every run even when the column is already nullable (lib/ddl-skip.ts does not
    -- cover it), so the catalog is asked first: once current, this takes no table lock.
    DO $stages_operations_stage_nullable$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema() AND table_name = 'production_operations'
                    AND column_name = 'stage_id' AND is_nullable = 'NO') THEN
        ALTER TABLE production_operations ALTER COLUMN stage_id DROP NOT NULL;
      END IF;
    END
    $stages_operations_stage_nullable$;
    -- (end STAGES)

    -- PRODUCTS (Продукция: norms, «Прикрепить операцию») ----------------------------------------------
    -- The place of a norm's line. NULL = by id: imported norms keep the reference's order, and the lines
    -- of a new product keep the order of its dialog. A line added to a norm later gets a place before the
    -- norm's others (lib/production-stages-repo.ts addRecipeComponent): the reference lists it first.
    ALTER TABLE production_recipe_items ADD COLUMN IF NOT EXISTS sort_order INTEGER;
    -- Operations attached to a stage product (the reference's product_operations {operations, products}).
    -- A product's links go with its norm; an operation with links is kept (deleteOperation answers 409
    -- with the usage list before its cascade could run).
    CREATE TABLE IF NOT EXISTS production_product_operations (
      id SERIAL PRIMARY KEY,
      recipe_id INTEGER NOT NULL REFERENCES production_recipes(id) ON DELETE CASCADE,
      operation_id INTEGER NOT NULL REFERENCES production_operations(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS production_product_operations_pair_idx ON production_product_operations (recipe_id, operation_id);
    CREATE INDEX IF NOT EXISTS production_product_operations_operation_idx ON production_product_operations (operation_id);
    -- (end PRODUCTS)

    -- LIST (Партии: the list's «Готовый продукт» / «Сырье» filters) -------------------------------------------
    -- The batch a booked line belongs to when the batch itself does not list it: a write-off / output copied from
    -- Linko that its batch no longer shows is kept without a batch (party_id NULL, so it is no part of the batch's
    -- lines, totals or cancel), but the reference's made_product / raw_product filters still find that batch through
    -- it. NULL on every other line. Filled by the Linko import (scripts/linko-sync); read only by listParties.
    ALTER TABLE production_movements ADD COLUMN IF NOT EXISTS source_party_id INTEGER;
    -- (end LIST)

    -- SESSIONS (Активность → «Смены»: a worker's shift session, «Передать на склад») ---------------------------
    -- Linko's staff/personal_rotation: one worker (an employee of the stage's Персонал) on one shift of the Смены
    -- directory, from «Начало смены» to «Конец смены» (NULL = «Не закончилась»). A supervisor opens and closes it on
    -- the web (lib/production-sessions-repo.ts). The shift entries the worker books on the stage while it is open
    -- belong to it (production_movements.session_id). «Передать на склад» moves the session's output to a warehouse
    -- as an «Отгрузка» (internal_transfers source 'shipment', source_id = the session); transfer_id points at it.
    -- The worker and the shift are kept by id; the names are snapshots shown only once the employee or the shift is
    -- gone. stage_id has no cascade (deleteStage answers 409 with the usage list); a roster row may be removed once
    -- its sessions are closed (deleteStaff: 409 while one is open; the link is cleared, the session keeps employee and
    -- shift). At most one open session per employee.
    CREATE TABLE IF NOT EXISTS production_shift_sessions (
      id SERIAL PRIMARY KEY,
      stage_id INTEGER NOT NULL REFERENCES production_stages(id),
      staff_id INTEGER REFERENCES production_staff(id) ON DELETE SET NULL,
      employee_id INTEGER NOT NULL,
      employee_name TEXT NOT NULL DEFAULT '',
      shift_id INTEGER NOT NULL,
      shift_name TEXT NOT NULL DEFAULT '',
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      opened_by TEXT NOT NULL DEFAULT '',
      closed_by TEXT NOT NULL DEFAULT '',
      transfer_id INTEGER,
      transferred_at TEXT NOT NULL DEFAULT '',
      transferred_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
    CREATE UNIQUE INDEX IF NOT EXISTS production_shift_sessions_open_uidx ON production_shift_sessions (employee_id) WHERE closed_at IS NULL;
    CREATE INDEX IF NOT EXISTS production_shift_sessions_stage_idx ON production_shift_sessions (stage_id, opened_at);
    CREATE INDEX IF NOT EXISTS production_shift_sessions_employee_idx ON production_shift_sessions (employee_id, opened_at);
    CREATE INDEX IF NOT EXISTS production_shift_sessions_staff_idx ON production_shift_sessions (staff_id);
    CREATE INDEX IF NOT EXISTS production_shift_sessions_shift_idx ON production_shift_sessions (shift_id);
    -- The session a shift entry belongs to (NULL: an entry outside any session, as every entry before v10).
    ALTER TABLE production_movements ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES production_shift_sessions(id);
    CREATE INDEX IF NOT EXISTS production_movements_session_idx ON production_movements (session_id) WHERE session_id IS NOT NULL;
    -- (end SESSIONS)
  `)
}

/** Lazily creates / upgrades the production tables once per process and returns the db. */
export async function getProductionDb(): Promise<PgDb> {
  const db = getDb()
  if (globalThis.__linkoProductionSchema?.version !== PRODUCTION_SCHEMA_VERSION) {
    const ready = outsideTransaction(() => createSchema(getDb())).catch((error) => {
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
