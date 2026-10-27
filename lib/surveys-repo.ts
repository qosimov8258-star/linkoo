import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { dbErrorResponse } from "@/lib/db-errors"
import { listClientTypes } from "@/lib/client-types-repo"
import { getDb, outsideTransaction } from "@/lib/db"
import { listOrganizations } from "@/lib/organizations-repo"
import { nameKey } from "@/lib/platform-refs"

// "Опросник" (/analytics/surveys). A survey belongs to one of the factory's own organizations
// (/api/organizations, required) and optionally to one client type (/api/client-types; none =
// "Не указано"): surveys.organization_id / client_type_id, validated on every write (400
// "Организация не найдена" / "Тип клиента не найден"). organization / store_type keep the names (the
// organization rename cascade and delete check of lib/organizations-repo.ts find surveys by them);
// reads show the current names of linked ones. The Excel import may send the names instead.

export type Survey = {
  id: number
  name: string
  createdAt: string
  active: boolean
  organization: string
  /** null = a survey saved before surveys were linked by id (only the name is known). */
  organizationId: number | null
  /** Client type name ("" = not set). */
  storeType: string
  clientTypeId: number | null
  comment: string
}

type Row = {
  id: number
  name: string
  active: number
  organization: string
  organization_id: number | null
  store_type: string
  client_type_id: number | null
  comment: string
  created_at: string
}

export class SurveyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field?: string,
  ) {
    super(message)
  }
}

export function surveyErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof SurveyError) return NextResponse.json({ error: error.message, ...(error.field ? { field: error.field } : {}) }, { status: error.status })
  return dbErrorResponse(error)
}

declare global {
  var __linkoSurveysSchema: Promise<void> | undefined
}

/** Idempotent on a fresh and an existing database. */
function ensureSchema(): Promise<void> {
  if (!globalThis.__linkoSurveysSchema) {
    globalThis.__linkoSurveysSchema = outsideTransaction(async () => {
      const db = getDb()
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
      await db.exec("ALTER TABLE surveys ADD COLUMN IF NOT EXISTS organization_id INTEGER, ADD COLUMN IF NOT EXISTS client_type_id INTEGER")
    }).catch((error) => {
      globalThis.__linkoSurveysSchema = undefined
      throw error
    })
  }
  return globalThis.__linkoSurveysSchema
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      .format(new Date(iso.replace(" ", "T") + "Z"))
      .replace(" г.", "")
  } catch {
    return iso
  }
}

/** "Не указано" / empty = no client type. */
const NOT_SET = new Set(["", "не указано", "не указан", "—", "-"])

type Directory = { organizations: Map<number, string>; clientTypes: Map<number, string> }

async function directory(): Promise<Directory> {
  const [organizations, clientTypes] = await Promise.all([listOrganizations(""), listClientTypes()])
  return {
    organizations: new Map(organizations.map((row) => [Number(row.id), row.name])),
    clientTypes: new Map(clientTypes.map((row) => [Number(row.id), row.name])),
  }
}

/** The stored id when that organization / client type still exists, else null (the stored name is shown). */
function liveId(value: number | null | undefined, known: Map<number, string>): number | null {
  if (value === null || value === undefined) return null
  return known.has(Number(value)) ? Number(value) : null
}

function rowToSurvey(row: Row, refs: Directory): Survey {
  // A deleted one reads as "older survey" (name only), so the edit dialog never sends back an id
  // the API refuses.
  const organizationId = liveId(row.organization_id, refs.organizations)
  const clientTypeId = liveId(row.client_type_id, refs.clientTypes)
  return {
    id: Number(row.id),
    name: row.name,
    createdAt: formatDate(row.created_at),
    active: !!row.active,
    organization: (organizationId !== null ? refs.organizations.get(organizationId) : undefined) ?? row.organization ?? "",
    organizationId,
    storeType: (clientTypeId !== null ? refs.clientTypes.get(clientTypeId) : undefined) ?? (NOT_SET.has(nameKey(row.store_type ?? "")) ? "" : row.store_type),
    clientTypeId,
    comment: row.comment ?? "",
  }
}

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

const id = z.number().int().positive().max(2_147_483_647)

/** POST / PUT body. organizationId (or the organization name) is required; clientTypeId / storeType optional (null / "" = none). */
export const surveyBodySchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(255, "Не более 255 символов"),
  active: z.boolean().optional(),
  organizationId: id.nullish(),
  organization: z.string().trim().max(255, "Не более 255 символов").optional(),
  clientTypeId: id.nullish(),
  storeType: z.string().trim().max(255, "Не более 255 символов").optional(),
  comment: z.string().max(2000, "Не более 2000 символов").optional(),
})

export type SurveyBody = z.infer<typeof surveyBodySchema>

type SurveyValues = { name: string; active: boolean; organizationId: number; organization: string; clientTypeId: number | null; storeType: string; comment: string }

/** Resolves and checks the organization and the client type (they must exist). */
async function surveyValues(body: SurveyBody): Promise<SurveyValues> {
  const refs = await directory()
  let organizationId: number | null = null
  if (body.organizationId) {
    if (!refs.organizations.has(body.organizationId)) throw new SurveyError("Организация не найдена", 400, "organizationId")
    organizationId = body.organizationId
  } else if (body.organization) {
    const key = nameKey(body.organization)
    organizationId = [...refs.organizations].find(([, name]) => nameKey(name) === key)?.[0] ?? null
    if (organizationId === null) throw new SurveyError("Организация не найдена", 400, "organizationId")
  }
  if (organizationId === null) throw new SurveyError("Выберите организацию", 400, "organizationId")

  let clientTypeId: number | null = null
  if (body.clientTypeId) {
    if (!refs.clientTypes.has(body.clientTypeId)) throw new SurveyError("Тип клиента не найден", 400, "clientTypeId")
    clientTypeId = body.clientTypeId
  } else if (body.storeType && !NOT_SET.has(nameKey(body.storeType))) {
    const key = nameKey(body.storeType)
    clientTypeId = [...refs.clientTypes].find(([, name]) => nameKey(name) === key)?.[0] ?? null
    if (clientTypeId === null) throw new SurveyError("Тип клиента не найден", 400, "clientTypeId")
  }
  return {
    name: body.name,
    active: body.active ?? true,
    organizationId,
    organization: refs.organizations.get(organizationId)!,
    clientTypeId,
    storeType: clientTypeId === null ? "" : refs.clientTypes.get(clientTypeId)!,
    comment: body.comment ?? "",
  }
}

// ---------------------------------------------------------------------------
// Reads / writes
// ---------------------------------------------------------------------------

export async function listSurveys(): Promise<Survey[]> {
  await ensureSchema()
  const [rows, refs] = await Promise.all([getDb().prepare("SELECT * FROM surveys ORDER BY id DESC").all() as Promise<Row[]>, directory()])
  return rows.map((row) => rowToSurvey(row, refs))
}

export async function getSurvey(surveyId: number): Promise<Survey | null> {
  await ensureSchema()
  const row = (await getDb().prepare("SELECT * FROM surveys WHERE id = ?").get(surveyId)) as Row | undefined
  return row ? rowToSurvey(row, await directory()) : null
}

function params(values: SurveyValues) {
  return { ...values, active: values.active ? 1 : 0 }
}

export async function createSurvey(body: SurveyBody): Promise<Survey> {
  await ensureSchema()
  const values = await surveyValues(body)
  const result = await getDb()
    .prepare(
      `INSERT INTO surveys (name, active, organization, organization_id, store_type, client_type_id, comment)
       VALUES (@name, @active, @organization, @organizationId, @storeType, @clientTypeId, @comment)`,
    )
    .run(params(values))
  return (await getSurvey(Number(result.lastInsertRowid)))!
}

export async function updateSurvey(surveyId: number, body: SurveyBody): Promise<Survey | null> {
  await ensureSchema()
  if (!(await getDb().prepare("SELECT id FROM surveys WHERE id = ?").get(surveyId))) return null
  const values = await surveyValues(body)
  await getDb()
    .prepare(
      `UPDATE surveys SET name = @name, active = @active, organization = @organization, organization_id = @organizationId,
         store_type = @storeType, client_type_id = @clientTypeId, comment = @comment, updated_at = datetime('now') WHERE id = @id`,
    )
    .run({ ...params(values), id: surveyId })
  return getSurvey(surveyId)
}

export async function deleteSurvey(surveyId: number): Promise<boolean> {
  await ensureSchema()
  return (await getDb().prepare("DELETE FROM surveys WHERE id = ?").run(surveyId)).changes > 0
}
