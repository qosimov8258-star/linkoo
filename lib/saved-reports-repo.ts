import "server-only"

import { getDb } from "@/lib/db"

export type SavedReport = {
  id: number
  name: string
  config: unknown
}

type Row = {
  id: number
  name: string
  config: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS saved_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function parseConfig(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return {}
  }
}

function rowToSavedReport(row: Row): SavedReport {
  return { id: row.id, name: row.name, config: parseConfig(row.config) }
}

export type SavedReportInput = {
  name: string
  config: unknown
}

export function parseSavedReportInput(body: unknown): SavedReportInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const config = value.config !== undefined ? value.config : {}
  return { name, config }
}

export async function listSavedReports(): Promise<SavedReport[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM saved_reports ORDER BY id ASC").all()) as Row[]).map(rowToSavedReport)
}

export async function createSavedReport(input: SavedReportInput): Promise<SavedReport> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare("INSERT INTO saved_reports (name, config) VALUES (@name, @config)")
      .run({ name: input.name, config: JSON.stringify(input.config) }))
  const row = (await db.prepare("SELECT * FROM saved_reports WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToSavedReport(row)
}
