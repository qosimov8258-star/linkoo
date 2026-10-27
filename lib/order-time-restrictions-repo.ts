import "server-only"

import { getDb, inTransaction, isolated, outsideTransaction, withTransaction } from "@/lib/db"
import { nowLocalIso } from "@/lib/finance/dates"
import {
  MSG_CREATE_BLOCKED,
  MSG_EDIT_BLOCKED,
  MSG_EMPLOYEE_NOT_FOUND,
  ORDER_TIME_CODES,
  ORDER_TIME_NAMES,
  allowedAt,
  clockText,
  isOrderTimeStatus,
  localIsoSeconds,
  type OrderTimeAction,
  type OrderTimeCode,
  type OrderTimeRestriction,
  type OrderTimeStatus,
} from "@/lib/order-time-restrictions-rules"
import type { OrderTimeRestrictionUpdate } from "@/lib/order-time-restrictions-schema"

// Ограничение времени: the two system rows (one per guarded order action, see
// lib/order-time-restrictions-rules.ts) and the employees a row is limited to.
//
//   order_time_restrictions           id, code (order_create | order_edit, unique), name
//                                     (the Russian name, informational: the page shows the
//                                     i18n key of the code), status 1..4, from_time / to_time
//                                     TIME (only for statuses 3 / 4), is_all, updated_at.
//   order_time_restriction_employees  (restriction_id, employee_id): the agents a row with
//                                     is_all = false applies to. Deleting an employee drops
//                                     its assignments (they are the employee's own setting,
//                                     like the reference's user.accesses), never a document.
//
// The schema is created / migrated once per process on the maintenance pool (never inside
// a request transaction) under an advisory lock, and the two rows are seeded idempotently
// (ON CONFLICT (code) DO NOTHING), so a fresh database always has them. An older database
// (the first draft: free-text rows with a full_day flag and TEXT times) is migrated in place:
// its rows named like the system rows are adopted, the times become TIME.

export class OrderTimeRestrictionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

const SCHEMA_VERSION = 1
const CODES = Object.keys(ORDER_TIME_CODES) as OrderTimeCode[]
const TIME_RE = String.raw`'^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'`

declare global {
  var __linkoOrderTimeRestrictionsSchema: { version: number; ready: Promise<void>; done: boolean } | undefined
}

function ensureSchema(): Promise<void> {
  if (globalThis.__linkoOrderTimeRestrictionsSchema?.version !== SCHEMA_VERSION) {
    const state = { version: SCHEMA_VERSION, ready: Promise.resolve(), done: false }
    state.ready = outsideTransaction(() =>
      withTransaction(async (tx) => {
        await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:order_time_restrictions:schema'))")
        await tx.exec(`
          CREATE TABLE IF NOT EXISTS order_time_restrictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT,
            name TEXT NOT NULL DEFAULT '',
            status SMALLINT NOT NULL DEFAULT 1,
            from_time TIME,
            to_time TIME,
            is_all BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `)
        await tx.exec("ALTER TABLE order_time_restrictions ADD COLUMN IF NOT EXISTS code TEXT")
        await tx.exec("ALTER TABLE order_time_restrictions ADD COLUMN IF NOT EXISTS status SMALLINT NOT NULL DEFAULT 1")
        await tx.exec("ALTER TABLE order_time_restrictions ADD COLUMN IF NOT EXISTS is_all BOOLEAN NOT NULL DEFAULT TRUE")
        // The first draft stored TEXT times ('00:00' / '23:59', NOT NULL) and a full_day flag:
        // adopt its rows named like the system rows, then turn the times into TIME (NULL for
        // statuses 1 / 2 and for anything that is not a valid clock time).
        await tx.exec(`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = current_schema() AND table_name = 'order_time_restrictions'
                          AND column_name = 'from_time' AND data_type <> 'time without time zone') THEN
              IF EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_schema = current_schema() AND table_name = 'order_time_restrictions' AND column_name = 'full_day') THEN
                UPDATE order_time_restrictions o
                   SET code = m.code,
                       status = CASE WHEN o.full_day = 0 AND o.from_time ~ ${TIME_RE} AND o.to_time ~ ${TIME_RE}
                                      AND left(o.from_time, 5) <> left(o.to_time, 5) THEN 3 ELSE 1 END
                  FROM (SELECT DISTINCT ON (k.code) k.id, k.code
                          FROM (SELECT id,
                                       CASE lower(btrim(name)) WHEN lower('Создания заказа') THEN 'order_create'
                                                               WHEN lower('Редактировать заказ') THEN 'order_edit' END AS code
                                  FROM order_time_restrictions WHERE code IS NULL) k
                         WHERE k.code IS NOT NULL
                           AND NOT EXISTS (SELECT 1 FROM order_time_restrictions t WHERE t.code = k.code)
                         ORDER BY k.code, k.id) m
                 WHERE o.id = m.id;
              END IF;
              ALTER TABLE order_time_restrictions
                ALTER COLUMN from_time DROP DEFAULT, ALTER COLUMN from_time DROP NOT NULL,
                ALTER COLUMN to_time DROP DEFAULT, ALTER COLUMN to_time DROP NOT NULL;
              ALTER TABLE order_time_restrictions
                ALTER COLUMN from_time TYPE TIME USING (CASE WHEN status IN (3, 4) AND from_time ~ ${TIME_RE} THEN from_time::time END),
                ALTER COLUMN to_time TYPE TIME USING (CASE WHEN status IN (3, 4) AND to_time ~ ${TIME_RE} THEN to_time::time END);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint
                            WHERE conrelid = 'order_time_restrictions'::regclass AND conname = 'order_time_restrictions_status_check') THEN
              UPDATE order_time_restrictions SET status = 1 WHERE status IS NULL OR status NOT BETWEEN 1 AND 4;
              ALTER TABLE order_time_restrictions ADD CONSTRAINT order_time_restrictions_status_check CHECK (status BETWEEN 1 AND 4);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint
                            WHERE conrelid = 'order_time_restrictions'::regclass AND conname = 'order_time_restrictions_times_check') THEN
              UPDATE order_time_restrictions SET from_time = NULL, to_time = NULL
               WHERE status IN (1, 2) AND (from_time IS NOT NULL OR to_time IS NOT NULL);
              UPDATE order_time_restrictions SET status = 1, from_time = NULL, to_time = NULL
               WHERE status IN (3, 4) AND (from_time IS NULL OR to_time IS NULL OR from_time = to_time);
              ALTER TABLE order_time_restrictions ADD CONSTRAINT order_time_restrictions_times_check CHECK (
                (status IN (1, 2) AND from_time IS NULL AND to_time IS NULL)
                OR (status IN (3, 4) AND from_time IS NOT NULL AND to_time IS NOT NULL AND from_time <> to_time));
            END IF;
          END $$;
        `)
        await tx.exec("CREATE UNIQUE INDEX IF NOT EXISTS order_time_restrictions_code_key ON order_time_restrictions (code)")
        await tx.exec(`
          INSERT INTO order_time_restrictions (code, name, status, is_all)
          VALUES ('order_create', 'Создания заказа', 1, TRUE), ('order_edit', 'Редактировать заказ', 1, TRUE)
          ON CONFLICT (code) DO NOTHING
        `)
        await tx.exec(`
          CREATE TABLE IF NOT EXISTS order_time_restriction_employees (
            restriction_id INTEGER NOT NULL REFERENCES order_time_restrictions(id) ON DELETE CASCADE,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (restriction_id, employee_id)
          );
        `)
        await tx.exec("CREATE INDEX IF NOT EXISTS order_time_restriction_employees_employee_idx ON order_time_restriction_employees (employee_id)")
      }),
    ).then(
      () => {
        state.done = true
      },
      (error) => {
        if (globalThis.__linkoOrderTimeRestrictionsSchema === state) globalThis.__linkoOrderTimeRestrictionsSchema = undefined
        throw error
      },
    )
    globalThis.__linkoOrderTimeRestrictionsSchema = state
  }
  return globalThis.__linkoOrderTimeRestrictionsSchema!.ready
}

type Row = {
  id: number
  code: string
  status: number | string
  from_time: string | null
  to_time: string | null
  is_all: boolean
  updated_at: string
  employees: Array<{ id: number; name: string; position: string | null; active: boolean }> | null
}

const SELECT_ROWS = `
  SELECT r.id, r.code, r.status, r.from_time::text AS from_time, r.to_time::text AS to_time, r.is_all, r.updated_at,
         COALESCE((SELECT json_agg(json_build_object('id', e.id,
                                                     'name', btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')),
                                                     'position', coalesce(e.position, ''),
                                                     'active', e.active = 1)
                                   ORDER BY lower(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, ''))), e.id)
                     FROM order_time_restriction_employees a JOIN employees e ON e.id = a.employee_id
                    WHERE a.restriction_id = r.id), '[]'::json) AS employees
    FROM order_time_restrictions r`

function toRestriction(row: Row): OrderTimeRestriction {
  const code = row.code as OrderTimeCode
  const status = Number(row.status)
  return {
    id: Number(row.id),
    code,
    name: ORDER_TIME_NAMES[code],
    status: (isOrderTimeStatus(status) ? status : 1) as OrderTimeStatus,
    fromTime: clockText(row.from_time) || null,
    toTime: clockText(row.to_time) || null,
    isAll: Boolean(row.is_all),
    employees: (row.employees ?? []).map((employee) => ({
      id: Number(employee.id),
      name: employee.name,
      position: employee.position ?? "",
      active: Boolean(employee.active),
    })),
    updatedAt: row.updated_at,
  }
}

/** Both system rows, in their fixed order (Создания заказа, Редактировать заказ). */
export async function listOrderTimeRestrictions(): Promise<OrderTimeRestriction[]> {
  await ensureSchema()
  const rows = (await getDb()
    .prepare(`${SELECT_ROWS} WHERE r.code = ANY(@codes::text[]) ORDER BY array_position(@codes::text[], r.code), r.id`)
    .all({ codes: CODES })) as Row[]
  return rows.map(toRestriction)
}

export async function getOrderTimeRestriction(id: number): Promise<OrderTimeRestriction | null> {
  await ensureSchema()
  const row = (await getDb().prepare(`${SELECT_ROWS} WHERE r.id = @id AND r.code = ANY(@codes::text[])`).get({ id, codes: CODES })) as Row | undefined
  return row ? toRestriction(row) : null
}

/**
 * Sets a restriction's window (the "Время работы" dialog). The row is locked FOR UPDATE,
 * so parallel saves apply one after the other. `employeeIds` (when given) replaces the list
 * of agents the row is limited to; every id must be an existing employee (400 otherwise).
 * null when the id is not one of the system rows.
 */
export async function updateOrderTimeRestriction(id: number, input: OrderTimeRestrictionUpdate): Promise<OrderTimeRestriction | null> {
  await ensureSchema()
  const found = await withTransaction(async (tx) => {
    const current = await tx.prepare("SELECT id FROM order_time_restrictions WHERE id = @id AND code = ANY(@codes::text[]) FOR UPDATE").get({ id, codes: CODES })
    if (!current) return false
    if (input.employeeIds) {
      const ids = input.employeeIds
      const existing = (await tx.prepare("SELECT id FROM employees WHERE id = ANY(@ids::int[]) FOR KEY SHARE").all({ ids })) as Array<{ id: number }>
      const known = new Set(existing.map((row) => Number(row.id)))
      const missing = ids.filter((employeeId) => !known.has(employeeId))
      if (missing.length) throw new OrderTimeRestrictionError(MSG_EMPLOYEE_NOT_FOUND, 400, { field: "employeeIds", missing })
    }
    await tx
      .prepare(
        `UPDATE order_time_restrictions
            SET status = @status, from_time = @fromTime::time, to_time = @toTime::time, is_all = @isAll, updated_at = datetime('now')
          WHERE id = @id`,
      )
      .run({ id, status: input.status, fromTime: input.fromTime, toTime: input.toTime, isAll: input.isAll })
    if (input.employeeIds) {
      const ids = input.employeeIds
      await tx.prepare("DELETE FROM order_time_restriction_employees WHERE restriction_id = @id AND NOT (employee_id = ANY(@ids::int[]))").run({ id, ids })
      // RETURNING names a column of this table (it has no id for db.ts to return).
      await tx
        .prepare(
          `INSERT INTO order_time_restriction_employees (restriction_id, employee_id)
           SELECT @id, employee_id FROM unnest(@ids::int[]) AS employee_id
           ON CONFLICT DO NOTHING RETURNING employee_id`,
        )
        .run({ id, ids })
    }
    return true
  })
  return found ? await getOrderTimeRestriction(id) : null
}

export type OrderTimeCheck = {
  action: OrderTimeAction
  allowed: boolean
  /** The restriction applies to this account (an agent of an "all" row, or an assigned one). */
  restricted: boolean
  status: OrderTimeStatus
  fromTime: string | null
  toTime: string | null
  /** Asia/Tashkent clock the decision used, "HH:MM:SS". */
  serverTime: string
  /** Russian i18n key of the refusal, or null when allowed. */
  reason: string | null
}

export type OrderTimeActor = { role: string; employeeId: number | null }

type CheckRow = { status: number | string; from_time: string | null; to_time: string | null; is_all: boolean; assigned: boolean }

async function readCheckRow(code: OrderTimeCode, employeeId: number): Promise<CheckRow | undefined> {
  return (await getDb()
    .prepare(
      `SELECT r.status, r.from_time::text AS from_time, r.to_time::text AS to_time, r.is_all,
              EXISTS (SELECT 1 FROM order_time_restriction_employees a WHERE a.restriction_id = r.id AND a.employee_id = @employeeId) AS assigned
         FROM order_time_restrictions r WHERE r.code = @code`,
    )
    .get({ code, employeeId })) as CheckRow | undefined
}

/**
 * Whether `actor` may create / edit an order now. Administrators and accounts that are not
 * linked to an employee are never restricted. Safe to call inside a transaction: the schema
 * is only awaited outside one; inside one, before this process finished it, the rows are read
 * guarded (a missing or not yet migrated table restricts nothing — the seeded rows allow all).
 */
export async function checkOrderTimeRestriction(action: OrderTimeAction, actor: OrderTimeActor, now = new Date()): Promise<OrderTimeCheck> {
  const local = nowLocalIso(now)
  const base: OrderTimeCheck = { action, allowed: true, restricted: false, status: 1, fromTime: null, toTime: null, serverTime: local.slice(11, 19), reason: null }
  if (actor.role === "admin" || !actor.employeeId) return base
  const code = (Object.entries(ORDER_TIME_CODES).find(([, value]) => value === action)?.[0] ?? "order_create") as OrderTimeCode
  let row: CheckRow | undefined
  if (inTransaction() && !globalThis.__linkoOrderTimeRestrictionsSchema?.done) {
    row = await isolated(async () => {
      const exists = (await getDb().prepare("SELECT to_regclass('order_time_restriction_employees') IS NOT NULL AS ok").get()) as { ok: boolean }
      return exists.ok ? await readCheckRow(code, actor.employeeId!) : undefined
    }).catch(() => undefined)
  } else {
    await ensureSchema()
    row = await readCheckRow(code, actor.employeeId)
  }
  if (!row) return base
  const status = Number(row.status)
  const fromTime = clockText(row.from_time) || null
  const toTime = clockText(row.to_time) || null
  const restricted = Boolean(row.is_all) || Boolean(row.assigned)
  const result: OrderTimeCheck = { ...base, restricted, status: (isOrderTimeStatus(status) ? status : 1) as OrderTimeStatus, fromTime, toTime }
  if (!restricted) return result
  const allowed = allowedAt(status, row.from_time, row.to_time, localIsoSeconds(local))
  return { ...result, allowed, reason: allowed ? null : action === "create" ? MSG_CREATE_BLOCKED : MSG_EDIT_BLOCKED }
}
