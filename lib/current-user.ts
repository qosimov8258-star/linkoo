import "server-only"

import { cookies } from "next/headers"

import { getDb } from "@/lib/db"
import { SESSION_COOKIE, verifySession, type Role } from "@/lib/session"
import { isSessionRevoked, touchSession } from "@/lib/user-sessions-repo"

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
  mustChangePassword: boolean
}

type UserRow = {
  id: number
  username: string
  display_name: string
  role: string
  access_right_id: number | null
  must_change_password: number | null
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
 * no recorded session id is treated as signed out. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  const session = await verifySession(token)
  if (!session || !session.sessionId) return null

  if (await isSessionRevoked(session.sessionId)) return null

  const db = getDb()
  const row = (await db
    .prepare("SELECT id, username, display_name, role, access_right_id, must_change_password FROM users WHERE id = ?")
    .get(session.userId)) as UserRow | undefined
  if (!row) return null

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
    mustChangePassword: row.must_change_password === 1,
  }
}
