import "server-only"

import { isUniqueViolation } from "@/lib/auth-request"
import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { refreshEmployeePositions, withEmployeeLinks } from "@/lib/employees-usage"
import type { AccessRight } from "@/components/analytics/access-rights-data"

type Row = { id: number; name: string; capability_ids: string }

function rowToAccessRight(row: Row): AccessRight {
  let capabilityIds: number[] = []
  try {
    const parsed = JSON.parse(row.capability_ids) as unknown
    capabilityIds = Array.isArray(parsed) ? parsed.filter((item): item is number => Number.isInteger(item)) : []
  } catch {
    capabilityIds = []
  }
  return { id: row.id, name: row.name, capabilityIds }
}

export type AccessRightInput = { name: string; capabilityIds: number[] }

export type AccessRightUsage = { table: string; label: string; count: number }

/** Validation / conflict errors with the HTTP status the routes answer. */
export class AccessRightError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly usage?: AccessRightUsage[],
  ) {
    super(message)
  }
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

/** Unique ids, every one an existing capability (400 otherwise). */
async function checkedCapabilityIds(db: PgDb, ids: number[]): Promise<number[]> {
  const unique = [...new Set(ids)]
  if (!unique.length) return []
  const rows = (await db.prepare("SELECT id FROM capabilities WHERE id = ANY(?::int[])").all(unique)) as { id: number }[]
  const known = new Set(rows.map((row) => Number(row.id)))
  const missing = unique.filter((id) => !known.has(id))
  if (missing.length) throw new AccessRightError(`Неизвестная возможность: ${missing.join(", ")}`, 400)
  return unique
}

async function assertNameFree(db: PgDb, name: string, exceptId: number) {
  const twin = await db.prepare("SELECT id FROM access_rights WHERE lower(btrim(name)) = lower(btrim(?)) AND id <> ?").get(name, exceptId)
  if (twin) throw new AccessRightError("Такое право доступа уже существует", 409)
}

function duplicateGuard(error: unknown): never {
  if (isUniqueViolation(error)) throw new AccessRightError("Такое право доступа уже существует", 409)
  throw error
}

export async function createAccessRight(input: AccessRightInput): Promise<AccessRight> {
  try {
    const id = await withTransaction(async (tx) => {
      await tx.prepare("LOCK TABLE access_rights IN SHARE ROW EXCLUSIVE MODE").run()
      await assertNameFree(tx, input.name, 0)
      const capabilityIds = await checkedCapabilityIds(tx, input.capabilityIds)
      const result = await tx
        .prepare("INSERT INTO access_rights (name, capability_ids) VALUES (@name, @capabilityIds)")
        .run({ name: input.name, capabilityIds: JSON.stringify(capabilityIds) })
      return Number(result.lastInsertRowid)
    })
    return (await getAccessRight(id))!
  } catch (error) {
    return duplicateGuard(error)
  }
}

export async function updateAccessRight(id: number, input: AccessRightInput): Promise<AccessRight | null> {
  try {
    const found = await withTransaction(async (tx) => {
      await tx.prepare("LOCK TABLE access_rights IN SHARE ROW EXCLUSIVE MODE").run()
      if (!(await tx.prepare("SELECT 1 FROM access_rights WHERE id = ?").get(id))) return false
      await assertNameFree(tx, input.name, id)
      const capabilityIds = await checkedCapabilityIds(tx, input.capabilityIds)
      await tx
        .prepare("UPDATE access_rights SET name = @name, capability_ids = @capabilityIds, updated_at = datetime('now') WHERE id = @id")
        .run({ id, name: input.name, capabilityIds: JSON.stringify(capabilityIds) })
      // employees.position ("access right · job") of the employees linked by access_right_id follows the new name.
      await refreshEmployeePositions(tx, "access_rights", id)
      return true
    })
    return found ? await getAccessRight(id) : null
  } catch (error) {
    return duplicateGuard(error)
  }
}

/** Where an access right is used: users (users.access_right_id), employees
 * (employees.access_right_id) and dashboard widgets shown to it
 * (dashboard_widgets.access_right_ids, a JSON array). */
export async function accessRightUsage(db: PgDb, id: number): Promise<AccessRightUsage[]> {
  const usage: AccessRightUsage[] = []
  const users = (await db.prepare("SELECT COUNT(*)::int AS count FROM users WHERE access_right_id = ?").get(id)) as { count: number }
  if (users.count) usage.push({ table: "users", label: "Пользователи", count: users.count })
  const widgetRows = (await db
    .prepare("SELECT access_right_ids FROM dashboard_widgets WHERE access_right_ids LIKE ?")
    .all(`%${id}%`)) as { access_right_ids: string }[]
  const widgets = widgetRows.filter((row) => {
    try {
      const ids = JSON.parse(row.access_right_ids) as unknown
      return Array.isArray(ids) && ids.some((value) => Number(value) === id)
    } catch {
      return false
    }
  }).length
  if (widgets) usage.push({ table: "dashboard_widgets", label: "Виджеты дашборда", count: widgets })
  return withEmployeeLinks(db, "access_rights", { id }, usage)
}

export async function deleteAccessRight(id: number): Promise<boolean> {
  return withTransaction(async (tx) => {
    if (!(await tx.prepare("SELECT 1 FROM access_rights WHERE id = ? FOR UPDATE").get(id))) return false
    const usage = await accessRightUsage(tx, id)
    if (usage.length) throw new AccessRightError("Удаление невозможно из-за связи с другими данными", 409, usage)
    return (await tx.prepare("DELETE FROM access_rights WHERE id = ?").run(id)).changes > 0
  })
}
