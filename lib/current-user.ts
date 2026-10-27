import "server-only"

import { cookies } from "next/headers"

import { EMPLOYEE_ACCESS_SQL, ensureUserEmployeeLink } from "@/lib/auth-employee"
import { getDb } from "@/lib/db"
import { SESSION_COOKIE, verifySession, type Role } from "@/lib/session"
import { isSessionRevoked, revokeSession, touchSession } from "@/lib/user-sessions-repo"

export type CurrentUser = {
  id: number
  username: string
  displayName: string
  role: Role
  sessionId?: string
  /** Access right (Права доступа) the user is restricted to, or null (role model only). */
  accessRightId: number | null
  /** Permission codes granted by the access right; null = not restricted. */
  permissions: string[] | null
  /** The password must be changed first: every API but sign-in/out, /me, the
   * password change and the own sessions answers 403 passwordChangeRequired. */
  mustChangePassword: boolean
  /** Employee (Сотрудники) the account belongs to, or null. */
  employeeId: number | null
}

type UserRow = {
  id: number
  username: string
  display_name: string
  role: string
  access_right_id: number | null
  must_change_password: number | null
  employee_id: number | null
  has_access: boolean
}

function parseIds(raw: unknown): number[] {
  if (typeof raw !== "string") return []
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item) && item > 0) : []
  } catch {
    return []
  }
}

/** Permission codes granted by an access right (through its capabilities).
 * A dangling id (the access right was removed) grants nothing. */
export async function permissionsOfAccessRight(accessRightId: number): Promise<string[]> {
  const db = getDb()
  const right = (await db.prepare("SELECT capability_ids FROM access_rights WHERE id = ?").get(accessRightId)) as
    | { capability_ids: string }
    | undefined
  if (!right) return []
  const capabilityIds = parseIds(right.capability_ids)
  if (!capabilityIds.length) return []
  const capabilities = (await db.prepare("SELECT permission_ids FROM capabilities WHERE id = ANY(?::int[])").all(capabilityIds)) as {
    permission_ids: string
  }[]
  const permissionIds = [...new Set(capabilities.flatMap((row) => parseIds(row.permission_ids)))]
  if (!permissionIds.length) return []
  const rows = (await db.prepare("SELECT code FROM permissions WHERE id = ANY(?::int[]) ORDER BY code").all(permissionIds)) as { code: string }[]
  return rows.map((row) => row.code)
}

export function toRole(value: string): Role {
  return value === "admin" || value === "manager" ? value : "viewer"
}

/** Re-reads the user's role from Postgres on every call (not just from the
 * JWT claim) so a role change or account deactivation takes effect on the
 * very next request instead of waiting for the session to expire. A session
 * that was revoked (logout, "Завершить", password change) or whose token has
 * no recorded session id is treated as signed out, and so is an account whose
 * employee was deactivated or lost "Доступ к системе" (lib/auth-employee.ts).
 *
 * The edge gate for "the password must be changed" (middleware.ts) reads the
 * token's mark. A token without it while the account must change its password
 * was issued before that became required (an older sign-in, e.g. before the
 * first-start check flagged the seeded password, or a sign-in that raced an
 * administrator's reset): that session is ended here, so it can read nothing;
 * signing in again gives a marked token and the change form. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  const session = await verifySession(token)
  if (!session || !session.sessionId) return null

  if (await isSessionRevoked(session.sessionId)) return null

  await ensureUserEmployeeLink()
  const db = getDb()
  const row = (await db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.access_right_id, u.must_change_password, u.employee_id,
              ${EMPLOYEE_ACCESS_SQL} AS has_access
         FROM users u LEFT JOIN employees e ON e.id = u.employee_id
        WHERE u.id = ?`,
    )
    .get(session.userId)) as UserRow | undefined
  if (!row || !row.has_access) return null
  if (Number(row.must_change_password) === 1 && !session.mustChangePassword) {
    await revokeSession(session.sessionId, row.id)
    return null
  }

  await touchSession(session.sessionId)

  const role = toRole(row.role)
  const accessRightId = role !== "admin" && row.access_right_id ? Number(row.access_right_id) : null
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role,
    sessionId: session.sessionId,
    accessRightId,
    permissions: accessRightId ? await permissionsOfAccessRight(accessRightId) : null,
    mustChangePassword: Number(row.must_change_password) === 1,
    employeeId: row.employee_id === null ? null : Number(row.employee_id),
  }
}
