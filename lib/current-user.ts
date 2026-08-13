import "server-only"

import { cookies } from "next/headers"

import { getDb } from "@/lib/db"
import { SESSION_COOKIE, verifySession } from "@/lib/session"

export type CurrentUser = { id: number; username: string; displayName: string }

type UserRow = { id: number; username: string; display_name: string }

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  const session = await verifySession(token)
  if (!session) return null

  const db = getDb()
  const row = db.prepare("SELECT id, username, display_name FROM users WHERE id = ?").get(session.userId) as
    | UserRow
    | undefined
  if (!row) return null

  return { id: row.id, username: row.username, displayName: row.display_name }
}
