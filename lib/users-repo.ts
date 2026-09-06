import "server-only"

import { getDb } from "@/lib/db"
import { hashPassword } from "@/lib/auth"
import type { Role } from "@/lib/session"

export type DashboardUser = { id: number; username: string; displayName: string; role: Role; createdAt: string }

type Row = { id: number; username: string; display_name: string; role: string; created_at: string }

function rowToUser(row: Row): DashboardUser {
  const role: Role = row.role === "admin" || row.role === "manager" ? row.role : "viewer"
  return { id: row.id, username: row.username, displayName: row.display_name, role, createdAt: row.created_at }
}

export async function listUsers(): Promise<DashboardUser[]> {
  const db = getDb()
  return ((await db.prepare("SELECT id, username, display_name, role, created_at FROM users ORDER BY id ASC").all()) as Row[]).map(
    rowToUser,
  )
}

export type CreateUserInput = { username: string; password: string; displayName: string; role: Role }

export async function createUser(input: CreateUserInput): Promise<DashboardUser | null> {
  const db = getDb()
  const existing = await db.prepare("SELECT id FROM users WHERE username = ?").get(input.username)
  if (existing) return null
  const hash = await hashPassword(input.password)
  const result = await db
    .prepare("INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)")
    .run(input.username, input.displayName, hash, input.role)
  const row = (await db
    .prepare("SELECT id, username, display_name, role, created_at FROM users WHERE id = ?")
    .get(result.lastInsertRowid)) as Row
  return rowToUser(row)
}

export async function deleteUser(id: number): Promise<boolean> {
  const db = getDb()
  const result = await db.prepare("DELETE FROM users WHERE id = ?").run(id)
  return result.changes > 0
}
