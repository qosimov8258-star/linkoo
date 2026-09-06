import "server-only"

import { getDb } from "@/lib/db"

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS new_report_builder_saves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      report_type TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

export type NewReportBuilderSave = {
  id: number
  name: string
  reportType: string
  config: Record<string, unknown>
  createdAt: string
}

type Row = {
  id: number
  name: string
  report_type: string
  config: string
  created_at: string
}

function rowToSave(row: Row): NewReportBuilderSave {
  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(row.config) as Record<string, unknown>
  } catch {
    config = {}
  }
  return { id: row.id, name: row.name, reportType: row.report_type, config, createdAt: row.created_at }
}

export type NewReportBuilderSaveInput = {
  name: string
  reportType: string
  config: Record<string, unknown>
}

export async function listNewReportBuilderSaves(): Promise<NewReportBuilderSave[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM new_report_builder_saves ORDER BY id DESC").all()) as Row[]).map(rowToSave)
}

export async function deleteNewReportBuilderSave(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db.prepare("DELETE FROM new_report_builder_saves WHERE id = ?").run(id))
  return result.changes > 0
}

export async function createNewReportBuilderSave(input: NewReportBuilderSaveInput): Promise<NewReportBuilderSave> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare("INSERT INTO new_report_builder_saves (name, report_type, config) VALUES (@name, @reportType, @config)")
      .run({ name: input.name, reportType: input.reportType, config: JSON.stringify(input.config) }))
  const row = (await db.prepare("SELECT * FROM new_report_builder_saves WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToSave(row)
}
