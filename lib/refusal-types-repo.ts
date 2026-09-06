import "server-only"

import { getDb } from "@/lib/db"

export type RefusalType = {
  id: number
  name: string
  resolution: string
}

type Row = {
  id: number
  name: string
  resolution: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS refusal_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      resolution TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToRefusalType(row: Row): RefusalType {
  return { id: row.id, name: row.name, resolution: row.resolution }
}

export type RefusalTypeInput = { name: string; resolution: string }

export function parseRefusalTypeInput(body: unknown): RefusalTypeInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const resolution = typeof value.resolution === "string" ? value.resolution.trim() : ""
  return { name, resolution }
}

export async function listRefusalTypes(): Promise<RefusalType[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM refusal_types ORDER BY id ASC").all()) as Row[]).map(rowToRefusalType)
}

export async function getRefusalType(id: number): Promise<RefusalType | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM refusal_types WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToRefusalType(row) : null
}

export async function createRefusalType(input: RefusalTypeInput): Promise<RefusalType> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare("INSERT INTO refusal_types (name, resolution) VALUES (@name, @resolution)")
      .run(input))
  return (await getRefusalType(Number(result.lastInsertRowid)))!
}

export async function updateRefusalType(id: number, input: RefusalTypeInput): Promise<RefusalType | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getRefusalType(id))) return null
  await db.prepare("UPDATE refusal_types SET name = @name, resolution = @resolution, updated_at = datetime('now') WHERE id = @id").run({
        id,
        name: input.name,
        resolution: input.resolution,
      })
  return (await getRefusalType(id))
}

export async function deleteRefusalType(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM refusal_types WHERE id = ?").run(id)).changes > 0
}
