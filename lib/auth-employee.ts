import "server-only"

import { getDb, outsideTransaction, type PgDb } from "@/lib/db"
import type { Role } from "@/lib/session"
import { revokeAllSessionsForUser } from "@/lib/user-sessions-repo"

// A sign-in account (users) may belong to an employee (Сотрудники) through
// users.employee_id. While it does, the employee decides whether the account
// may sign in: a deactivated employee (active = 0), one whose "Доступ к
// системе" is off, or a link to an employee that no longer exists blocks the
// sign-in and every live session of the account (lib/current-user.ts). An
// account without an employee (the first administrator, service accounts)
// is not affected.

declare global {
  var __linkoUserEmployeeLink: Promise<void> | undefined
}

/** Adds users.employee_id (nullable, one account per employee) on first use.
 * Idempotent, for a fresh and an existing database alike; nothing is backfilled.
 * Call it before opening a transaction that reads the column. */
export function ensureUserEmployeeLink(): Promise<void> {
  if (!globalThis.__linkoUserEmployeeLink) {
    globalThis.__linkoUserEmployeeLink = outsideTransaction(createLink).catch((error) => {
      globalThis.__linkoUserEmployeeLink = undefined
      throw error
    })
  }
  return globalThis.__linkoUserEmployeeLink
}

async function createLink(): Promise<void> {
  const db = getDb()
  // ALTER TABLE locks the table even when the column exists, so it only runs while missing.
  const column = await db
    .prepare(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'employee_id'",
    )
    .get()
  if (!column) await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id INTEGER")
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'users_employee_id_key') THEN
        BEGIN
          CREATE UNIQUE INDEX users_employee_id_key ON users (employee_id) WHERE employee_id IS NOT NULL;
        EXCEPTION WHEN duplicate_table OR unique_violation THEN
          NULL;
        END;
      END IF;
    END $$;
  `)
}

/** Serialises, until the transaction ends, every change that can stop an account
 * from signing in: an employee deactivated or losing "Доступ к системе"
 * (lib/employees-repo.ts updateEmployee), an account's role or employee link
 * changed, an account deleted (lib/users-repo.ts). Their guards ("not the last
 * administrator", "not your own account") read rows other transactions may be
 * changing; under this lock two such changes cannot both pass them.
 * Take it first in the transaction, before any row lock. */
export async function lockAccessChanges(tx: PgDb): Promise<void> {
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('users:access'))").get()
}

/** Name of the unique index: a second account for the same employee violates it. */
export const USER_EMPLOYEE_INDEX = "users_employee_id_key"

/** SQL (over `users u LEFT JOIN employees e ON e.id = u.employee_id`): true when
 * the account may sign in as far as its employee is concerned. */
export const EMPLOYEE_ACCESS_SQL = "(u.employee_id IS NULL OR (e.id IS NOT NULL AND e.active = 1 AND e.system_access = 1))"

export type EmployeeAccount = { id: number; username: string; role: Role }

/** The account linked to an employee, if any. */
export async function accountOfEmployee(db: PgDb, employeeId: number): Promise<EmployeeAccount | null> {
  const row = (await db
    .prepare("SELECT id, username, role FROM users WHERE employee_id = ? ORDER BY id LIMIT 1")
    .get(employeeId)) as { id: number; username: string; role: string } | undefined
  if (!row) return null
  const role: Role = row.role === "admin" || row.role === "manager" ? row.role : "viewer"
  return { id: Number(row.id), username: row.username, role }
}

/** Administrators other than `exceptUserId` who can still sign in. */
export async function otherAdminsWithAccess(db: PgDb, exceptUserId: number): Promise<number> {
  const row = (await db
    .prepare(
      `SELECT COUNT(*)::int AS n FROM users u LEFT JOIN employees e ON e.id = u.employee_id
        WHERE u.role = 'admin' AND u.id <> ? AND ${EMPLOYEE_ACCESS_SQL}`,
    )
    .get(exceptUserId)) as { n: number } | undefined
  return Number(row?.n ?? 0)
}

/** Whether an employee lets its account sign in (exists, active, "Доступ к системе" on). */
export async function employeeAllowsAccess(db: PgDb, employeeId: number): Promise<boolean> {
  const row = (await db.prepare("SELECT active, system_access FROM employees WHERE id = ?").get(employeeId)) as
    | { active: number; system_access: number }
    | undefined
  return Boolean(row && Number(row.active) === 1 && Number(row.system_access) === 1)
}

/** Ends every live session of the accounts linked to the employee (it was
 * deactivated or lost its system access). */
export async function revokeEmployeeSessions(employeeId: number): Promise<number> {
  await ensureUserEmployeeLink()
  const rows = (await getDb().prepare("SELECT id FROM users WHERE employee_id = ?").all(employeeId)) as { id: number }[]
  let revoked = 0
  for (const row of rows) revoked += await revokeAllSessionsForUser(Number(row.id))
  return revoked
}
