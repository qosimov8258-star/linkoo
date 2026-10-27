import "server-only"

import { hashPassword } from "@/lib/auth"
import { isUniqueViolation } from "@/lib/auth-request"
import { getDb, withTransaction } from "@/lib/db"
import type { Role } from "@/lib/session"
import { revokeAllSessionsForUser } from "@/lib/user-sessions-repo"

export type DashboardUser = {
  id: number
  username: string
  displayName: string
  role: Role
  accessRightId: number | null
  mustChangePassword: boolean
  createdAt: string
}

type Row = {
  id: number
  username: string
  display_name: string
  role: string
  access_right_id: number | null
  must_change_password: number | null
  created_at: string
}

const COLUMNS = "id, username, display_name, role, access_right_id, must_change_password, created_at"

function rowToUser(row: Row): DashboardUser {
  const role: Role = row.role === "admin" || row.role === "manager" ? row.role : "viewer"
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role,
    accessRightId: row.access_right_id ?? null,
    mustChangePassword: row.must_change_password === 1,
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
  const db = getDb()
  return ((await db.prepare(`SELECT ${COLUMNS} FROM users ORDER BY id ASC`).all()) as Row[]).map(rowToUser)
}

export async function getUser(id: number): Promise<DashboardUser | null> {
  const db = getDb()
  const row = (await db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id)) as Row | undefined
  return row ? rowToUser(row) : null
}

async function assertAccessRight(db: ReturnType<typeof getDb>, accessRightId: number | null | undefined) {
  if (!accessRightId) return
  const exists = await db.prepare("SELECT 1 FROM access_rights WHERE id = ?").get(accessRightId)
  if (!exists) throw new UserError("Права доступа не найдены", 400)
}

export type CreateUserInput = {
  /** Already normalized (lib/auth-policy normalizeUsername). */
  username: string
  password: string
  displayName: string
  role: Role
  accessRightId?: number | null
  mustChangePassword?: boolean
}

/** Creates a user; returns null when the login is taken (case-insensitively). */
export async function createUser(input: CreateUserInput): Promise<DashboardUser | null> {
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
      const result = await tx
        .prepare(
          `INSERT INTO users (username, display_name, password_hash, role, access_right_id, must_change_password)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.username, input.displayName, hash, input.role, input.accessRightId ?? null, input.mustChangePassword ? 1 : 0)
      const row = (await tx.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(result.lastInsertRowid)) as Row
      return rowToUser(row)
    })
  } catch (error) {
    if (isUniqueViolation(error)) return null
    throw error
  }
}

export type UpdateUserInput = {
  displayName?: string
  role?: Role
  accessRightId?: number | null
  /** Administrator reset: the user must choose a new password at the next sign-in. */
  password?: string
}

export async function updateUser(id: number, input: UpdateUserInput): Promise<DashboardUser | null> {
  const db = getDb()
  const current = await getUser(id)
  if (!current) return null
  await assertAccessRight(db, input.accessRightId)
  const hash = input.password !== undefined ? await hashPassword(input.password) : null
  await withTransaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE users SET
           display_name = COALESCE(@displayName, display_name),
           role = COALESCE(@role, role),
           access_right_id = CASE WHEN @setAccess::boolean THEN @accessRightId::int ELSE access_right_id END,
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
        hash,
      })
  })
  // A new password, role or access right must not leave old sessions running
  // with the previous rights (their tokens also carry the old permissions).
  const accessChanged =
    (input.role !== undefined && input.role !== current.role) ||
    (input.accessRightId !== undefined && (input.accessRightId ?? null) !== current.accessRightId)
  if (hash || accessChanged) await revokeAllSessionsForUser(id)
  return getUser(id)
}

export async function deleteUser(id: number): Promise<boolean> {
  const db = getDb()
  const result = await db.prepare("DELETE FROM users WHERE id = ?").run(id)
  if (result.changes > 0) await revokeAllSessionsForUser(id)
  return result.changes > 0
}

/** Users linked to an access right (blocks deleting the access right). */
export async function countUsersWithAccessRight(accessRightId: number): Promise<number> {
  const db = getDb()
  const row = (await db.prepare("SELECT COUNT(*)::int AS count FROM users WHERE access_right_id = ?").get(accessRightId)) as { count: number }
  return row.count
}
