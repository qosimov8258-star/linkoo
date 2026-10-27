import "server-only"

import { getDb, outsideTransaction } from "@/lib/db"

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

let schemaReady: Promise<void> | null = null

async function ensureSchema() {
  if (!schemaReady) {
    // Process-wide DDL: never inside (and rolled back with) one caller's transaction.
    schemaReady = outsideTransaction(() =>
      getDb().exec(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          ip TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id);
      `),
    ).catch((error) => {
      schemaReady = null
      throw error
    })
  }
  await schemaReady
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
  await ensureSchema()
  await db.prepare(
    "INSERT INTO user_sessions (id, user_id, ip, user_agent) VALUES (@id, @userId, @ip, @userAgent)",
  ).run(input)
}

export async function touchSession(id: string): Promise<void> {
  const db = getDb()
  await ensureSchema()
  await db.prepare("UPDATE user_sessions SET last_seen_at = datetime('now') WHERE id = ?").run(id)
}

/** True when the session was revoked (logout, "Завершить", password change) or
 * is unknown: every sign-in records its session first, so a token whose id has
 * no row cannot be trusted either. */
export async function isSessionRevoked(id: string): Promise<boolean> {
  const db = getDb()
  await ensureSchema()
  const row = (await db.prepare("SELECT revoked_at FROM user_sessions WHERE id = ?").get(id)) as
    | { revoked_at: string | null }
    | undefined
  if (!row) return true
  return row.revoked_at !== null
}

export async function listSessionsForUser(userId: number): Promise<UserSession[]> {
  const db = getDb()
  await ensureSchema()
  return (
    (await db
      .prepare("SELECT * FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen_at DESC")
      .all(userId)) as Row[]
  ).map(rowToSession)
}

export async function revokeSession(id: string, userId: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema()
  const result = await db
    .prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .run(id, userId)
  return result.changes > 0
}

export async function revokeOtherSessions(userId: number, exceptId: string): Promise<number> {
  const db = getDb()
  await ensureSchema()
  const result = await db
    .prepare(
      "UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND id != ? AND revoked_at IS NULL",
    )
    .run(userId, exceptId)
  return result.changes
}

/** Revokes every live session of a user (password reset, account change), except `exceptId`. */
export async function revokeAllSessionsForUser(userId: number, exceptId?: string): Promise<number> {
  const db = getDb()
  await ensureSchema()
  const result = await db
    .prepare("UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND id != ? AND revoked_at IS NULL")
    .run(userId, exceptId ?? "")
  return result.changes
}
