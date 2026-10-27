import "server-only"

import { isUniqueViolation } from "@/lib/auth-request"
import { getDb, withTransaction, type PgDb } from "@/lib/db"
import type { Capability } from "@/components/analytics/access-rights-data"

type Row = { id: number; name: string; permission_ids: string }

function parseIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is number => Number.isInteger(item)) : []
  } catch {
    return []
  }
}

function rowToCapability(row: Row): Capability {
  return { id: row.id, name: row.name, permissionIds: parseIds(row.permission_ids) }
}

export type CapabilityUsage = { table: string; label: string; count: number }

export class CapabilityError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly usage?: CapabilityUsage[],
  ) {
    super(message)
  }
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

/** Unique ids, every one a permission of the catalogue (400 otherwise). */
async function checkedPermissionIds(db: PgDb, ids: number[]): Promise<number[]> {
  const unique = [...new Set(ids)]
  if (!unique.length) return []
  const rows = (await db.prepare("SELECT id FROM permissions WHERE id = ANY(?::int[])").all(unique)) as { id: number }[]
  const known = new Set(rows.map((row) => Number(row.id)))
  const missing = unique.filter((id) => !known.has(id))
  if (missing.length) throw new CapabilityError(`Неизвестное разрешение: ${missing.join(", ")}`, 400)
  return unique
}

async function assertNameFree(db: PgDb, name: string, exceptId: number) {
  const twin = await db.prepare("SELECT id FROM capabilities WHERE lower(btrim(name)) = lower(btrim(?)) AND id <> ?").get(name, exceptId)
  if (twin) throw new CapabilityError("Такая возможность уже существует", 409)
}

function duplicateGuard(error: unknown): never {
  if (isUniqueViolation(error)) throw new CapabilityError("Такая возможность уже существует", 409)
  throw error
}

export async function createCapability(name: string, permissionIds: number[] = []): Promise<Capability> {
  try {
    const id = await withTransaction(async (tx) => {
      await tx.prepare("LOCK TABLE capabilities IN SHARE ROW EXCLUSIVE MODE").run()
      await assertNameFree(tx, name, 0)
      const ids = await checkedPermissionIds(tx, permissionIds)
      const result = await tx.prepare("INSERT INTO capabilities (name, permission_ids) VALUES (?, ?)").run(name, JSON.stringify(ids))
      return Number(result.lastInsertRowid)
    })
    return (await getCapability(id))!
  } catch (error) {
    return duplicateGuard(error)
  }
}

export async function updateCapability(id: number, name: string, permissionIds?: number[]): Promise<Capability | null> {
  try {
    const found = await withTransaction(async (tx) => {
      await tx.prepare("LOCK TABLE capabilities IN SHARE ROW EXCLUSIVE MODE").run()
      const row = (await tx.prepare("SELECT id, name, permission_ids FROM capabilities WHERE id = ?").get(id)) as Row | undefined
      if (!row) return false
      await assertNameFree(tx, name, id)
      const ids = permissionIds === undefined ? parseIds(row.permission_ids) : await checkedPermissionIds(tx, permissionIds)
      await tx
        .prepare("UPDATE capabilities SET name = @name, permission_ids = @permissionIds, updated_at = datetime('now') WHERE id = @id")
        .run({ id, name, permissionIds: JSON.stringify(ids) })
      return true
    })
    return found ? await getCapability(id) : null
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Access rights that include the capability (capability_ids JSON arrays). */
async function capabilityUsage(db: PgDb, id: number): Promise<CapabilityUsage[]> {
  const rows = (await db.prepare("SELECT capability_ids FROM access_rights WHERE capability_ids LIKE ?").all(`%${id}%`)) as {
    capability_ids: string
  }[]
  const count = rows.filter((row) => parseIds(row.capability_ids).includes(id)).length
  return count ? [{ table: "access_rights", label: "Права доступа", count }] : []
}

export async function deleteCapability(id: number): Promise<boolean> {
  return withTransaction(async (tx) => {
    if (!(await tx.prepare("SELECT 1 FROM capabilities WHERE id = ? FOR UPDATE").get(id))) return false
    const usage = await capabilityUsage(tx, id)
    if (usage.length) throw new CapabilityError("Удаление невозможно из-за связи с другими данными", 409, usage)
    return (await tx.prepare("DELETE FROM capabilities WHERE id = ?").run(id)).changes > 0
  })
}
