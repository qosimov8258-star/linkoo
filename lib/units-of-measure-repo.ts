import "server-only"

import { getDb } from "@/lib/db"
import type { UnitOfMeasure } from "@/components/analytics/units-of-measure-data"

type Row = {
  id: number
  name: string
  parent_id: number | null
  created_at: string
}

function rowToUnit(row: Row): UnitOfMeasure {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdDate: new Date(row.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }),
  }
}

export type UnitOfMeasureInput = { name: string; parentId: number | null }

export function parseUnitOfMeasureInput(body: unknown): UnitOfMeasureInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const parentIdRaw = value.parentId
  const parentId = typeof parentIdRaw === "number" && Number.isFinite(parentIdRaw) ? parentIdRaw : null
  return { name, parentId }
}

export async function listUnitsOfMeasure(): Promise<UnitOfMeasure[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT * FROM units_of_measure ORDER BY id DESC").all()) as Row[]
  return rows.map(rowToUnit)
}

export async function getUnitOfMeasure(id: number): Promise<UnitOfMeasure | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM units_of_measure WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToUnit(row) : null
}

export async function createUnitOfMeasure(input: UnitOfMeasureInput): Promise<UnitOfMeasure> {
  const db = getDb()
  const result = (await db
      .prepare("INSERT INTO units_of_measure (name, parent_id) VALUES (@name, @parentId)")
      .run({ name: input.name, parentId: input.parentId }))
  return (await getUnitOfMeasure(Number(result.lastInsertRowid)))!
}

export async function updateUnitOfMeasure(id: number, input: UnitOfMeasureInput): Promise<UnitOfMeasure | null> {
  if (!(await getUnitOfMeasure(id))) return null
  const db = getDb()
  await db.prepare(
        "UPDATE units_of_measure SET name = @name, parent_id = @parentId, updated_at = datetime('now') WHERE id = @id",
      ).run({ id, name: input.name, parentId: input.parentId })
  return (await getUnitOfMeasure(id))
}

// Matches the original UI behaviour: deleting a unit also removes any direct
// children pointing at it as their parent (one level, not recursive).
export async function deleteUnitOfMeasure(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM units_of_measure WHERE id = ? OR parent_id = ?").run(id, id))
  return result.changes > 0
}
