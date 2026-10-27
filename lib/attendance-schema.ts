import "server-only"

import { getDb, outsideTransaction, type PgDb } from "@/lib/db"

// Tables of Посещаемость (/analytics/work-attendance), see design-attendance.md:
// - attendance_weekend_days / attendance_weekend_months: the holiday days of a month
//   (month 0..11, as the table always had); a month without a marker row is
//   "Sundays + stored days" (what the earlier page saved), a marked one exactly the stored days;
// - attendance_settings: late_after ("Считать опозданием после");
// - attendance_check_ins: check-in / check-out events (mobile app, manager);
// - attendance_days: manual (Изменить) and Excel-import overrides of a day;
// - attendance_auto_days: the derived snapshot of past days (Перерасчет rebuilds it).
// Created lazily, idempotent on a fresh and an existing database, on the maintenance pool
// (outsideTransaction) once per process; every table has a serial id (the db shim appends
// RETURNING id to INSERTs run with .run()).

declare global {
  var __linkoAttendanceSchema: Promise<void> | undefined
}

async function createSchema(db: PgDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_weekend_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      day INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(year, month, day)
    )`)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_weekend_months (
      id SERIAL PRIMARY KEY,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(year, month)
    )`)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_settings (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_check_ins (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      user_id INTEGER,
      kind TEXT NOT NULL CHECK (kind IN ('in', 'out')),
      occurred_at TIMESTAMPTZ NOT NULL,
      local_day TEXT NOT NULL,
      local_time TEXT NOT NULL,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      accuracy DOUBLE PRECISION,
      place TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'mobile',
      device_id TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
  await db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS attendance_check_ins_idempotency_key ON attendance_check_ins (employee_id, idempotency_key) WHERE idempotency_key IS NOT NULL",
  )
  await db.exec("CREATE INDEX IF NOT EXISTS attendance_check_ins_day_idx ON attendance_check_ins (local_day, employee_id)")
  await db.exec("CREATE INDEX IF NOT EXISTS attendance_check_ins_employee_idx ON attendance_check_ins (employee_id, local_day)")
  await db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_days (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      type TEXT NOT NULL,
      arrival_time TEXT,
      late_minutes INTEGER NOT NULL DEFAULT 0,
      comment TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      updated_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(employee_id, day)
    )`)
  await db.exec("CREATE INDEX IF NOT EXISTS attendance_days_day_idx ON attendance_days (day)")
  await db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_auto_days (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      type TEXT NOT NULL,
      arrival_time TEXT,
      leave_time TEXT,
      late_minutes INTEGER NOT NULL DEFAULT 0,
      late_after TEXT NOT NULL,
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(employee_id, day)
    )`)
  await db.exec("CREATE INDEX IF NOT EXISTS attendance_auto_days_day_idx ON attendance_auto_days (day)")
}

/** Creates the attendance tables once per process (call before any transaction that uses them). */
export function ensureAttendanceSchema(): Promise<void> {
  if (!globalThis.__linkoAttendanceSchema) {
    globalThis.__linkoAttendanceSchema = outsideTransaction(() => createSchema(getDb())).catch((error) => {
      globalThis.__linkoAttendanceSchema = undefined
      throw error
    })
  }
  return globalThis.__linkoAttendanceSchema
}

/** Exclusive (materialize, Перерасчет, holidays, manual edits, import) or shared (check-ins)
 * advisory lock of one month until the transaction ends. Taken before any other attendance lock. */
export async function lockAttendanceMonth(tx: PgDb, month: string, shared = false): Promise<void> {
  const fn = shared ? "pg_advisory_xact_lock_shared" : "pg_advisory_xact_lock"
  await tx.prepare(`SELECT ${fn}(hashtext(@key)) AS locked`).get({ key: `attendance:month:${month.slice(0, 7)}` })
}

/** Serialises the check-ins of one employee (idempotency lookup + in/out order check + insert). */
export async function lockAttendanceEmployee(tx: PgDb, employeeId: number): Promise<void> {
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext(@key)) AS locked").get({ key: `attendance:employee:${employeeId}` })
}
