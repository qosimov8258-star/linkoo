import "server-only"

import { getDb } from "@/lib/db"

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS trend_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

export type TrendReport = {
  id: number
  name: string
  config: Record<string, unknown>
  createdAt: string
}

type Row = {
  id: number
  name: string
  config: string
  created_at: string
}

function rowToReport(row: Row): TrendReport {
  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(row.config) as Record<string, unknown>
  } catch {
    config = {}
  }
  return { id: row.id, name: row.name, config, createdAt: row.created_at }
}

export type TrendReportInput = {
  name: string
  config: Record<string, unknown>
}

export function parseTrendReportInput(body: unknown): TrendReportInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const config = value.config && typeof value.config === "object" ? (value.config as Record<string, unknown>) : {}
  return { name, config }
}

export async function listTrendReports(): Promise<TrendReport[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM trend_reports ORDER BY id DESC").all()) as Row[]).map(rowToReport)
}

export async function createTrendReport(input: TrendReportInput): Promise<TrendReport> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare("INSERT INTO trend_reports (name, config) VALUES (@name, @config)")
      .run({ name: input.name, config: JSON.stringify(input.config) }))
  const row = (await db.prepare("SELECT * FROM trend_reports WHERE id = ?").get(Number(result.lastInsertRowid))) as Row
  return rowToReport(row)
}
