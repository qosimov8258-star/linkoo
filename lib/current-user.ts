import "server-only"

import { cookies } from "next/headers"

import { getDb } from "@/lib/db"
import { SESSION_COOKIE, verifySession, type Role } from "@/lib/session"
import { isSessionRevoked, touchSession } from "@/lib/user-sessions-repo"

export type CurrentUser = { id: number; username: string; displayName: string; role: Role; sessionId?: string }

type UserRow = { id: number; username: string; display_name: string; role: string }

/** Re-reads the user's role from Postgres on every call (not just from the
 * JWT claim) so a role change or account deactivation takes effect on the
 * very next request instead of waiting for the session to expire. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  const session = await verifySession(token)
  if (!session) return null

  if (session.sessionId && (await isSessionRevoked(session.sessionId))) return null

  const db = getDb()
  const row = (await db.prepare("SELECT id, username, display_name, role FROM users WHERE id = ?").get(session.userId)) as
    | UserRow
    | undefined
  if (!row) return null

  if (session.sessionId) await touchSession(session.sessionId)

  const role: Role = row.role === "admin" || row.role === "manager" ? row.role : "viewer"
  return { id: row.id, username: row.username, displayName: row.display_name, role, sessionId: session.sessionId }
}
