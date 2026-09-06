import "server-only"

import { getDb } from "@/lib/db"
import type { Capability } from "@/components/analytics/access-rights-data"

type Row = { id: number; name: string; permission_ids: string }

function rowToCapability(row: Row): Capability {
  let permissionIds: number[] = []
  try {
    permissionIds = JSON.parse(row.permission_ids) as number[]
  } catch {
    permissionIds = []
  }
  return { id: row.id, name: row.name, permissionIds }
}

export async function listCapabilities(): Promise<Capability[]> {
  const db = getDb()
  return ((await db.prepare("SELECT id, name, permission_ids FROM capabilities ORDER BY id ASC").all()) as Row[]).map(rowToCapability)
}

export async function getCapability(id: number): Promise<Capability | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT id, name, permission_ids FROM capabilities WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToCapability(row) : null
}

export function parseCapabilityName(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  return name || null
}

export function parsePermissionIds(body: unknown): number[] | undefined {
  if (!body || typeof body !== "object") return undefined
  const value = body as Record<string, unknown>
  if (!Array.isArray(value.permissionIds)) return undefined
  return value.permissionIds.filter((item): item is number => typeof item === "number")
}

export async function createCapability(name: string): Promise<Capability | null> {
  const db = getDb()
  try {
    const result = (await db.prepare("INSERT INTO capabilities (name) VALUES (?)").run(name))
    return (await getCapability(Number(result.lastInsertRowid)))
  } catch {
    return null
  }
}

export async function updateCapability(id: number, name: string, permissionIds?: number[]): Promise<Capability | null> {
  const db = getDb()
  const existing = (await getCapability(id))
  if (!existing) return null
  try {
    await db.prepare("UPDATE capabilities SET name = @name, permission_ids = @permissionIds, updated_at = datetime('now') WHERE id = @id").run({
            id,
            name,
            permissionIds: JSON.stringify(permissionIds ?? existing.permissionIds),
          })
    return (await getCapability(id))
  } catch {
    return null
  }
}

export async function deleteCapability(id: number): Promise<boolean> {
  const db = getDb()
  return (await db.prepare("DELETE FROM capabilities WHERE id = ?").run(id)).changes > 0
}
