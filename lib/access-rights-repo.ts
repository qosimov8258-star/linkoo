import "server-only"

import { getDb } from "@/lib/db"
import type { AccessRight } from "@/components/analytics/access-rights-data"

type Row = { id: number; name: string; capability_ids: string }

function rowToAccessRight(row: Row): AccessRight {
  let capabilityIds: number[] = []
  try {
    capabilityIds = JSON.parse(row.capability_ids) as number[]
  } catch {
    capabilityIds = []
  }
  return { id: row.id, name: row.name, capabilityIds }
}

export type AccessRightInput = { name: string; capabilityIds: number[] }

export function parseAccessRightInput(body: unknown): AccessRightInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const capabilityIds = Array.isArray(value.capabilityIds)
    ? value.capabilityIds.filter((item): item is number => typeof item === "number")
    : []
  return { name, capabilityIds }
}

export async function listAccessRights(): Promise<AccessRight[]> {
  const db = getDb()
  return ((await db.prepare("SELECT id, name, capability_ids FROM access_rights ORDER BY id ASC").all()) as Row[]).map(rowToAccessRight)
}

export async function getAccessRight(id: number): Promise<AccessRight | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT id, name, capability_ids FROM access_rights WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToAccessRight(row) : null
}

export async function createAccessRight(input: AccessRightInput): Promise<AccessRight> {
  const db = getDb()
  const result = (await db
      .prepare("INSERT INTO access_rights (name, capability_ids) VALUES (@name, @capabilityIds)")
      .run({ name: input.name, capabilityIds: JSON.stringify(input.capabilityIds) }))
  return (await getAccessRight(Number(result.lastInsertRowid)))!
}

export async function updateAccessRight(id: number, input: AccessRightInput): Promise<AccessRight | null> {
  const db = getDb()
  if (!(await getAccessRight(id))) return null
  await db.prepare("UPDATE access_rights SET name = @name, capability_ids = @capabilityIds, updated_at = datetime('now') WHERE id = @id").run({
        id,
        name: input.name,
        capabilityIds: JSON.stringify(input.capabilityIds),
      })
  return (await getAccessRight(id))
}

export async function deleteAccessRight(id: number): Promise<boolean> {
  const db = getDb()
  return (await db.prepare("DELETE FROM access_rights WHERE id = ?").run(id)).changes > 0
}
