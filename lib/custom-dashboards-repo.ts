import "server-only"

import { getDb } from "@/lib/db"

export type CustomDashboard = {
  id: number
  name: string
}

type Row = { id: number; name: string }

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS custom_dashboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function rowToDashboard(row: Row): CustomDashboard {
  return { id: row.id, name: row.name }
}

export type CustomDashboardInput = { name: string }

export function parseCustomDashboardInput(body: unknown): CustomDashboardInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  return { name }
}

export async function listCustomDashboards(): Promise<CustomDashboard[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM custom_dashboards ORDER BY id ASC").all()) as Row[]).map(rowToDashboard)
}

export async function getCustomDashboard(id: number): Promise<CustomDashboard | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM custom_dashboards WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToDashboard(row) : null
}

export async function createCustomDashboard(input: CustomDashboardInput): Promise<CustomDashboard> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db.prepare("INSERT INTO custom_dashboards (name) VALUES (@name)").run(input))
  return (await getCustomDashboard(Number(result.lastInsertRowid)))!
}

export async function updateCustomDashboard(id: number, input: CustomDashboardInput): Promise<CustomDashboard | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getCustomDashboard(id))) return null
  await db.prepare("UPDATE custom_dashboards SET name = @name, updated_at = datetime('now') WHERE id = @id").run({ id, name: input.name })
  return (await getCustomDashboard(id))
}

export async function deleteCustomDashboard(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM custom_dashboards WHERE id = ?").run(id)).changes > 0
}
