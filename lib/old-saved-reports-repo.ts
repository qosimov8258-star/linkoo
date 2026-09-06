import "server-only"

import { getDb } from "@/lib/db"

export type OldSavedReport = {
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
    CREATE TABLE IF NOT EXISTS old_saved_reports (
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

function rowToOldSavedReport(row: Row): OldSavedReport {
  return { id: row.id, name: row.name, config: parseConfig(row.config) }
}

export type OldSavedReportInput = {
  name: string
  config: unknown
}

export async function listOldSavedReports(): Promise<OldSavedReport[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM old_saved_reports ORDER BY id ASC").all()) as Row[]).map(rowToOldSavedReport)
}

export async function createOldSavedReport(input: OldSavedReportInput): Promise<OldSavedReport> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare("INSERT INTO old_saved_reports (name, config) VALUES (@name, @config)")
      .run({ name: input.name, config: JSON.stringify(input.config) }))
  const row = (await db.prepare("SELECT * FROM old_saved_reports WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToOldSavedReport(row)
}
