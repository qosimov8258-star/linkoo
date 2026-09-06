import "server-only"

import { getDb } from "@/lib/db"

export type UserSession = {
  id: string
  userId: number
  ip: string
  userAgent: string
  createdAt: string
  lastSeenAt: string
  revokedAt: string | null
}

type Row = {
  id: string
  user_id: number
  ip: string
  user_agent: string
  created_at: string
  last_seen_at: string
  revoked_at: string | null
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    );
  `)
}

function rowToSession(row: Row): UserSession {
  return {
    id: row.id,
    userId: row.user_id,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  }
}

export async function recordSession(input: { id: string; userId: number; ip: string; userAgent: string }): Promise<void> {
  const db = getDb()
  await ensureSchema(db)
  await db.prepare(
    "INSERT INTO user_sessions (id, user_id, ip, user_agent) VALUES (@id, @userId, @ip, @userAgent)",
  ).run(input)
}

export async function touchSession(id: string): Promise<void> {
  const db = getDb()
  await ensureSchema(db)
  await db.prepare("UPDATE user_sessions SET last_seen_at = datetime('now') WHERE id = ?").run(id)
}

export async function isSessionRevoked(id: string): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT revoked_at FROM user_sessions WHERE id = ?").get(id)) as
    | { revoked_at: string | null }
    | undefined
  if (!row) return false
  return row.revoked_at !== null
}

export async function listSessionsForUser(userId: number): Promise<UserSession[]> {
  const db = getDb()
  await ensureSchema(db)
  return (
    (await db
      .prepare("SELECT * FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC")
      .all(userId)) as Row[]
  ).map(rowToSession)
}

export async function revokeSession(id: string, userId: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .run(id, userId)
  return result.changes > 0
}

export async function revokeOtherSessions(userId: number, exceptId: string): Promise<number> {
  const db = getDb()
  await ensureSchema(db)
  const result = await db
    .prepare(
      "UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND id != ? AND revoked_at IS NULL",
    )
    .run(userId, exceptId)
  return result.changes
}
