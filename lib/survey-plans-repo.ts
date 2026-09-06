import "server-only"

import { getDb, withTransaction } from "@/lib/db"

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS survey_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period TEXT NOT NULL,
      employee TEXT NOT NULL,
      survey TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

export type SurveyPlanEntry = { period: string; employee: string; survey: string }

type Row = { id: number; period: string; employee: string; survey: string }

function rowToEntry(row: Row): SurveyPlanEntry {
  return { period: row.period, employee: row.employee, survey: row.survey }
}

export type SurveyPlanReplaceInput = { period: string; entries: { employee: string; survey: string }[] }

export function parseSurveyPlanReplaceInput(body: unknown): SurveyPlanReplaceInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const period = typeof value.period === "string" ? value.period.trim() : ""
  if (!period) return null
  const entriesRaw = Array.isArray(value.entries) ? value.entries : []
  const entries = entriesRaw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      employee: typeof item.employee === "string" ? item.employee.trim() : "",
      survey: typeof item.survey === "string" ? item.survey.trim() : "",
    }))
    .filter((item) => item.employee && item.survey)
  return { period, entries }
}

export async function listSurveyPlans(): Promise<SurveyPlanEntry[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM survey_plans ORDER BY id ASC").all()) as Row[]).map(rowToEntry)
}

export async function replaceSurveyPlanPeriod(input: SurveyPlanReplaceInput): Promise<SurveyPlanEntry[]> {
  await ensureSchema(getDb())
  await withTransaction(async (db) => {
    await db.prepare("DELETE FROM survey_plans WHERE period = ?").run(input.period)
    const insert = db.prepare("INSERT INTO survey_plans (period, employee, survey) VALUES (?, ?, ?)")
    for (const entry of input.entries) await insert.run(input.period, entry.employee, entry.survey)
  })
  const db = getDb()
  return ((await db.prepare("SELECT * FROM survey_plans WHERE period = ? ORDER BY id ASC").all(input.period)) as Row[]).map(rowToEntry)
}
