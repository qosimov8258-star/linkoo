import "server-only"

import { getDb } from "@/lib/db"

export type Survey = {
  id: number
  name: string
  createdAt: string
  active: boolean
  organization: string
  storeType: string
  comment: string
}

type Row = {
  id: number
  name: string
  active: number
  organization: string
  store_type: string
  comment: string
  created_at: string
}

async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS surveys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      organization TEXT NOT NULL DEFAULT '',
      store_type TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      .format(new Date(iso.replace(" ", "T") + "Z"))
      .replace(".", "")
  } catch {
    return iso
  }
}

function rowToSurvey(row: Row): Survey {
  return {
    id: row.id,
    name: row.name,
    createdAt: formatDate(row.created_at),
    active: !!row.active,
    organization: row.organization,
    storeType: row.store_type,
    comment: row.comment,
  }
}

export type SurveyInput = { name: string; active: boolean; organization: string; storeType: string; comment: string }

export function parseSurveyInput(body: unknown): SurveyInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name.trim() : ""
  if (!name) return null
  const active = typeof value.active === "boolean" ? value.active : true
  const organization = typeof value.organization === "string" ? value.organization : ""
  const storeType = typeof value.storeType === "string" ? value.storeType : ""
  const comment = typeof value.comment === "string" ? value.comment : ""
  return { name, active, organization, storeType, comment }
}

export async function listSurveys(): Promise<Survey[]> {
  const db = getDb()
  await ensureSchema(db)
  return ((await db.prepare("SELECT * FROM surveys ORDER BY id DESC").all()) as Row[]).map(rowToSurvey)
}

export async function getSurvey(id: number): Promise<Survey | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM surveys WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToSurvey(row) : null
}

export async function createSurvey(input: SurveyInput): Promise<Survey> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        "INSERT INTO surveys (name, active, organization, store_type, comment) VALUES (@name, @active, @organization, @storeType, @comment)",
      )
      .run({ name: input.name, active: input.active ? 1 : 0, organization: input.organization, storeType: input.storeType, comment: input.comment }))
  return (await getSurvey(Number(result.lastInsertRowid)))!
}

export async function updateSurvey(id: number, input: SurveyInput): Promise<Survey | null> {
  const db = getDb()
  await ensureSchema(db)
  if (!(await getSurvey(id))) return null
  await db.prepare(
        `UPDATE surveys SET name = @name, active = @active, organization = @organization, store_type = @storeType, comment = @comment, updated_at = datetime('now') WHERE id = @id`,
      ).run({ id, name: input.name, active: input.active ? 1 : 0, organization: input.organization, storeType: input.storeType, comment: input.comment })
  return (await getSurvey(id))
}

export async function deleteSurvey(id: number): Promise<boolean> {
  const db = getDb()
  await ensureSchema(db)
  return (await db.prepare("DELETE FROM surveys WHERE id = ?").run(id)).changes > 0
}
