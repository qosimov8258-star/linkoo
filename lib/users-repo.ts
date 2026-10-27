import "server-only"

import { hashPassword } from "@/lib/auth"
import { EMPLOYEE_ACCESS_SQL, ensureUserEmployeeLink, lockAccessChanges, otherAdminsWithAccess, USER_EMPLOYEE_INDEX } from "@/lib/auth-employee"
import { isUniqueViolation } from "@/lib/auth-request"
import { getDb, withTransaction, type PgDb } from "@/lib/db"
import type { Role } from "@/lib/session"
import { revokeAllSessionsForUser } from "@/lib/user-sessions-repo"

export type DashboardUser = {
  id: number
  username: string
  displayName: string
  role: Role
  accessRightId: number | null
  mustChangePassword: boolean
  /** Employee (Сотрудники) the account belongs to; its "Доступ к системе" and
   * status decide whether the account may sign in. */
  employeeId: number | null
  employeeName: string | null
  /** False when the linked employee is deactivated, has no system access or is gone. */
  canSignIn: boolean
  createdAt: string
}

type Row = {
  id: number
  username: string
  display_name: string
  role: string
  access_right_id: number | null
  must_change_password: number | null
  employee_id: number | null
  employee_name: string | null
  has_access: boolean
  created_at: string
}

const SELECT_USERS = `SELECT u.id, u.username, u.display_name, u.role, u.access_right_id, u.must_change_password, u.created_at,
         u.employee_id, NULLIF(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '') AS employee_name,
         ${EMPLOYEE_ACCESS_SQL} AS has_access
    FROM users u LEFT JOIN employees e ON e.id = u.employee_id`

function rowToUser(row: Row): DashboardUser {
  const role: Role = row.role === "admin" || row.role === "manager" ? row.role : "viewer"
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role,
    accessRightId: row.access_right_id ?? null,
    mustChangePassword: Number(row.must_change_password) === 1,
    employeeId: row.employee_id === null ? null : Number(row.employee_id),
    employeeName: row.employee_name ?? null,
    canSignIn: Boolean(row.has_access),
    createdAt: row.created_at,
  }
}

export class UserError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function listUsers(): Promise<DashboardUser[]> {
  await ensureUserEmployeeLink()
  const db = getDb()
  return ((await db.prepare(`${SELECT_USERS} ORDER BY u.id ASC`).all()) as Row[]).map(rowToUser)
}

async function readUser(db: PgDb, id: number): Promise<DashboardUser | null> {
  const row = (await db.prepare(`${SELECT_USERS} WHERE u.id = ?`).get(id)) as Row | undefined
  return row ? rowToUser(row) : null
}

export async function getUser(id: number): Promise<DashboardUser | null> {
  await ensureUserEmployeeLink()
  return readUser(getDb(), id)
}

async function assertAccessRight(db: PgDb, accessRightId: number | null | undefined) {
  if (!accessRightId) return
  const exists = await db.prepare("SELECT 1 FROM access_rights WHERE id = ?").get(accessRightId)
  if (!exists) throw new UserError("Права доступа не найдены", 400)
}

const EMPLOYEE_TAKEN = "Этот сотрудник уже привязан к другому пользователю"
const SELF_LINK_WITHOUT_ACCESS = "Нельзя привязать свою учетную запись к сотруднику без доступа к системе"
const LAST_ADMIN_ACCESS = "Нельзя отключить доступ последнему администратору"
const LAST_ADMIN_ROLE = "Нельзя снять роль администратора с последнего администратора"
const LAST_ADMIN_DELETE = "Нельзя удалить последнего администратора"

/** The employee must exist and must not belong to another account. Locks the
 * employee row (FOR SHARE) until the transaction ends, so it cannot be
 * deactivated, lose its system access or be deleted meanwhile. Returns whether
 * the employee lets its account sign in (active, "Доступ к системе" on). */
async function assertEmployee(db: PgDb, employeeId: number, userId?: number): Promise<boolean> {
  const row = (await db.prepare("SELECT active, system_access FROM employees WHERE id = ? FOR SHARE").get(employeeId)) as
    | { active: number; system_access: number }
    | undefined
  if (!row) throw new UserError("Сотрудник не найден", 400)
  const other = await db.prepare("SELECT 1 FROM users WHERE employee_id = ? AND id <> ?").get(employeeId, userId ?? 0)
  if (other) throw new UserError(EMPLOYEE_TAKEN, 409)
  return Number(row.active) === 1 && Number(row.system_access) === 1
}

function isEmployeeTaken(error: unknown): boolean {
  return isUniqueViolation(error) && (error as { constraint?: unknown }).constraint === USER_EMPLOYEE_INDEX
}

export type CreateUserInput = {
  /** Already normalized (lib/auth-policy normalizeUsername). */
  username: string
  password: string
  displayName: string
  role: Role
  accessRightId?: number | null
  /** The employee (Сотрудники) the account belongs to. */
  employeeId?: number | null
  mustChangePassword?: boolean
}

/** Creates a user; returns null when the login is taken (case-insensitively). */
export async function createUser(input: CreateUserInput): Promise<DashboardUser | null> {
  await ensureUserEmployeeLink()
  const db = getDb()
  await assertAccessRight(db, input.accessRightId)
  const hash = await hashPassword(input.password)
  try {
    return await withTransaction(async (tx) => {
      // Serialises concurrent creates, so two requests for the same login
      // cannot both pass the check (the second gets 409, not a 500).
      await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('users:create'))").get()
      const existing = await tx.prepare("SELECT id FROM users WHERE lower(username) = lower(?)").get(input.username)
      if (existing) return null
      if (input.employeeId) await assertEmployee(tx, input.employeeId)
      const result = await tx
        .prepare(
          `INSERT INTO users (username, display_name, password_hash, role, access_right_id, must_change_password, employee_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.username,
          input.displayName,
          hash,
          input.role,
          input.accessRightId ?? null,
          input.mustChangePassword ? 1 : 0,
          input.employeeId ?? null,
        )
      return readUser(tx, Number(result.lastInsertRowid))
    })
  } catch (error) {
    if (isEmployeeTaken(error)) throw new UserError(EMPLOYEE_TAKEN, 409)
    if (isUniqueViolation(error)) return null
    throw error
  }
}

export type UpdateUserInput = {
  displayName?: string
  role?: Role
  accessRightId?: number | null
  /** Link to an employee (null unlinks; undefined keeps the current link). */
  employeeId?: number | null
  /** Administrator reset: the user must choose a new password at the next sign-in. */
  password?: string
}

export type UpdateUserOptions = {
  /** The administrator making the change: linking their own account to an
   * employee without system access is refused (it would end their session). */
  actorId?: number
}

/** Updates an account. Role and employee link decide whether it can sign in,
 * so the change is serialised with every other change that can end a sign-in
 * (lib/auth-employee.ts lockAccessChanges) and its guards run inside that
 * lock: the last administrator who can sign in is never demoted or linked to
 * an employee without system access (409), and one's own account is never
 * linked to such an employee (400). */
export async function updateUser(id: number, input: UpdateUserInput, options: UpdateUserOptions = {}): Promise<DashboardUser | null> {
  await ensureUserEmployeeLink()
  const db = getDb()
  await assertAccessRight(db, input.accessRightId)
  const hash = input.password !== undefined ? await hashPassword(input.password) : null
  let current: DashboardUser | null
  try {
    current = await withTransaction(async (tx) => {
      await lockAccessChanges(tx)
      const before = await readUser(tx, id)
      if (!before) return null
      const setEmployee = input.employeeId !== undefined && (input.employeeId ?? null) !== before.employeeId
      let employeeAllowsAccess = true
      if (setEmployee && input.employeeId) {
        employeeAllowsAccess = await assertEmployee(tx, input.employeeId, id)
        if (!employeeAllowsAccess && options.actorId === id) throw new UserError(SELF_LINK_WITHOUT_ACCESS, 400)
      }
      const role = input.role ?? before.role
      const canSignIn = setEmployee ? employeeAllowsAccess : before.canSignIn
      if (before.role === "admin" && before.canSignIn && !(role === "admin" && canSignIn)) {
        if ((await otherAdminsWithAccess(tx, id)) === 0) throw new UserError(role !== "admin" ? LAST_ADMIN_ROLE : LAST_ADMIN_ACCESS, 409)
      }
      await tx
        .prepare(
          `UPDATE users SET
             display_name = COALESCE(@displayName, display_name),
             role = COALESCE(@role, role),
             access_right_id = CASE WHEN @setAccess::boolean THEN @accessRightId::int ELSE access_right_id END,
             employee_id = CASE WHEN @setEmployee::boolean THEN @employeeId::int ELSE employee_id END,
             password_hash = COALESCE(@hash, password_hash),
             must_change_password = CASE WHEN @hash::text IS NOT NULL THEN 1 ELSE must_change_password END,
             password_changed_at = CASE WHEN @hash::text IS NOT NULL THEN datetime('now') ELSE password_changed_at END
           WHERE id = @id`,
        )
        .run({
          id,
          displayName: input.displayName ?? null,
          role: input.role ?? null,
          setAccess: input.accessRightId !== undefined,
          accessRightId: input.accessRightId ?? null,
          setEmployee,
          employeeId: input.employeeId ?? null,
          hash,
        })
      return before
    })
  } catch (error) {
    if (isEmployeeTaken(error)) throw new UserError(EMPLOYEE_TAKEN, 409)
    throw error
  }
  if (!current) return null
  const updated = await getUser(id)
  // A new password, role or access right must not leave old sessions running
  // with the previous rights (their tokens carry the old role for the edge gates),
  // nor may a link to an employee without system access.
  const accessChanged =
    (input.role !== undefined && input.role !== current.role) ||
    (input.accessRightId !== undefined && (input.accessRightId ?? null) !== current.accessRightId) ||
    (updated !== null && !updated.canSignIn)
  if (hash || accessChanged) await revokeAllSessionsForUser(id)
  return updated
}

/** Deletes an account (its sessions end). Serialised like updateUser; the last
 * administrator who can sign in is never deleted (409). */
export async function deleteUser(id: number): Promise<boolean> {
  await ensureUserEmployeeLink()
  const deleted = await withTransaction(async (tx) => {
    await lockAccessChanges(tx)
    const target = await readUser(tx, id)
    if (!target) return false
    if (target.role === "admin" && target.canSignIn && (await otherAdminsWithAccess(tx, id)) === 0) {
      throw new UserError(LAST_ADMIN_DELETE, 409)
    }
    return (await tx.prepare("DELETE FROM users WHERE id = ?").run(id)).changes > 0
  })
  if (deleted) await revokeAllSessionsForUser(id)
  return deleted
}

/** Users linked to an access right (blocks deleting the access right). */
export async function countUsersWithAccessRight(accessRightId: number): Promise<number> {
  const db = getDb()
  const row = (await db.prepare("SELECT COUNT(*)::int AS count FROM users WHERE access_right_id = ?").get(accessRightId)) as { count: number }
  return row.count
}
