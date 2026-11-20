import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { getDb, outsideTransaction, withTransaction } from "@/lib/db"
import { MAX_DB_ID } from "@/lib/strict-number"

// "Perfect Store Config" (Продажи → Perfect store → Конфигурация), the reference's main/perfect_store_quiz_wrapper:
// a named set of questionnaires (Опросник, /analytics/surveys) of one organization, each marked whether it is the
// questionnaire of the store's main zone (Опросник основной зоны), and whether the config is active. The page lists
// them (search, page, page size), creates, edits and deletes them. A config names its organization by
// organizations.id (organization_id: the organization's delete check of lib/organizations-repo.ts finds it, so an
// organization in use is not deleted) and its questionnaires by surveys.id.

export type PerfectStoreConfigItem = { quizId: number; quizName: string; isStoreQuiz: boolean }

export type PerfectStoreConfig = {
  id: number
  name: string
  organizationId: number | null
  organization: string
  isActive: boolean
  items: PerfectStoreConfigItem[]
}

export type PerfectStoreConfigPage = { count: number; rows: PerfectStoreConfig[] }

/** A refused write: the message (a Russian i18n key) and the field it belongs to. */
export class PerfectStoreConfigError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly field?: string,
  ) {
    super(message)
  }
}

/** JSON answer of a PerfectStoreConfigError ({error, field}); null for anything else. */
export function perfectStoreConfigErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof PerfectStoreConfigError)) return null
  return NextResponse.json({ error: error.message, field: error.field ?? null }, { status: error.status })
}

declare global {
  var __linkoPerfectStoreConfigsSchema: Promise<void> | undefined
}

/** Idempotent on a fresh and an existing database (created once per process, outside any request transaction). */
function ensureSchema(): Promise<void> {
  if (!globalThis.__linkoPerfectStoreConfigsSchema) {
    globalThis.__linkoPerfectStoreConfigsSchema = outsideTransaction(async () => {
      await getDb().exec(`
        CREATE TABLE IF NOT EXISTS perfect_store_configs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          organization_id INTEGER,
          is_active INTEGER NOT NULL DEFAULT 0,
          items TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `)
    }).catch((error) => {
      globalThis.__linkoPerfectStoreConfigsSchema = undefined
      throw error
    })
  }
  return globalThis.__linkoPerfectStoreConfigsSchema
}

const REQUIRED = "Обязательное поле"
const id = z.number({ error: REQUIRED }).int("Неверные данные").positive("Неверные данные").max(MAX_DB_ID, "Неверные данные")

/** Body of POST / PUT: the reference's form (Наименование *, Организация *, Активный, the questionnaire rows). */
export const perfectStoreConfigBody = z.strictObject({
  name: z.string({ error: REQUIRED }).trim().min(1, REQUIRED).max(255, "Слишком длинное значение"),
  organizationId: z.union([id, z.null()], { error: REQUIRED }).refine((value) => value !== null, REQUIRED),
  isActive: z.boolean().default(false),
  items: z.array(z.strictObject({ quizId: id, isStoreQuiz: z.boolean().default(false) }), { error: "Неверные данные" }).max(200, "Неверные данные").default([]),
})
export type PerfectStoreConfigInput = z.infer<typeof perfectStoreConfigBody>

type Row = { id: number; name: string; organization_id: number | null; is_active: number; items: string; organization: string | null }

function storedItems(text: string): Array<{ quizId: number; isStoreQuiz: boolean }> {
  try {
    const value = JSON.parse(text || "[]") as unknown
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => {
      const quizId = Number((item as { quizId?: unknown })?.quizId)
      return Number.isSafeInteger(quizId) && quizId > 0 ? [{ quizId, isStoreQuiz: Boolean((item as { isStoreQuiz?: unknown }).isStoreQuiz) }] : []
    })
  } catch {
    return []
  }
}

async function surveyNames(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map()
  const exists = (await getDb().prepare("SELECT to_regclass('surveys') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (!exists?.ok) return new Map()
  const rows = (await getDb().prepare("SELECT id, name FROM surveys WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{ id: number; name: string }>
  return new Map(rows.map((row) => [Number(row.id), String(row.name ?? "")]))
}

async function toConfigs(rows: Row[]): Promise<PerfectStoreConfig[]> {
  const parsed = rows.map((row) => ({ row, items: storedItems(row.items) }))
  const names = await surveyNames([...new Set(parsed.flatMap(({ items }) => items.map((item) => item.quizId)))])
  return parsed.map(({ row, items }) => ({
    id: Number(row.id),
    name: row.name,
    organizationId: row.organization_id === null ? null : Number(row.organization_id),
    organization: row.organization ?? "",
    isActive: Boolean(Number(row.is_active)),
    items: items.map((item) => ({ ...item, quizName: names.get(item.quizId) ?? `#${item.quizId}` })),
  }))
}

const SELECT = `SELECT p.id, p.name, p.organization_id, p.is_active, p.items, o.name AS organization
                  FROM perfect_store_configs p LEFT JOIN organizations o ON o.id = p.organization_id`

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

/** A page of the list, newest first; `search` matches the name. */
export async function listPerfectStoreConfigs({ search, page, pageSize }: { search: string; page: number; pageSize: number }): Promise<PerfectStoreConfigPage> {
  await ensureSchema()
  const db = getDb()
  const where = search ? "WHERE p.name ILIKE @pattern" : ""
  const params = { pattern: likePattern(search), limit: pageSize, offset: (page - 1) * pageSize }
  const counted = (await db.prepare(`SELECT COUNT(*)::int AS n FROM perfect_store_configs p ${where}`).get(...(search ? [params] : []))) as { n: number } | undefined
  const rows = (await db.prepare(`${SELECT} ${where} ORDER BY p.id DESC LIMIT @limit OFFSET @offset`).all(params)) as Row[]
  return { count: Number(counted?.n ?? 0), rows: await toConfigs(rows) }
}

export async function getPerfectStoreConfig(configId: number): Promise<PerfectStoreConfig | null> {
  await ensureSchema()
  const row = (await getDb().prepare(`${SELECT} WHERE p.id = @id`).get({ id: configId })) as Row | undefined
  return row ? (await toConfigs([row]))[0] : null
}

/** The organization and every questionnaire must exist; a questionnaire listed twice keeps its first row. */
async function checked(input: PerfectStoreConfigInput): Promise<{ name: string; organizationId: number; isActive: boolean; items: string }> {
  const db = getDb()
  const organizationId = input.organizationId as number
  const organization = await db.prepare("SELECT 1 AS ok FROM organizations WHERE id = @id").get({ id: organizationId })
  if (!organization) throw new PerfectStoreConfigError("Организация не найдена", 400, "organizationId")
  const seen = new Set<number>()
  const items = input.items.filter((item) => !seen.has(item.quizId) && seen.add(item.quizId))
  const names = await surveyNames(items.map((item) => item.quizId))
  if (items.some((item) => !names.has(item.quizId))) throw new PerfectStoreConfigError("Опросник не найден", 400, "items")
  return { name: input.name, organizationId, isActive: input.isActive, items: JSON.stringify(items) }
}

export async function createPerfectStoreConfig(input: PerfectStoreConfigInput): Promise<PerfectStoreConfig> {
  await ensureSchema()
  const values = await checked(input)
  const created = (await getDb()
    .prepare("INSERT INTO perfect_store_configs (name, organization_id, is_active, items) VALUES (@name, @organizationId, @isActive, @items) RETURNING id")
    .get({ ...values, isActive: values.isActive ? 1 : 0 })) as { id: number }
  return (await getPerfectStoreConfig(Number(created.id))) as PerfectStoreConfig
}

/** Replaces a config; null when it does not exist. */
export async function updatePerfectStoreConfig(configId: number, input: PerfectStoreConfigInput): Promise<PerfectStoreConfig | null> {
  await ensureSchema()
  const values = await checked(input)
  const changed = await withTransaction(async (tx) =>
    tx
      .prepare("UPDATE perfect_store_configs SET name = @name, organization_id = @organizationId, is_active = @isActive, items = @items, updated_at = datetime('now') WHERE id = @id")
      .run({ ...values, isActive: values.isActive ? 1 : 0, id: configId }),
  )
  return changed.changes > 0 ? getPerfectStoreConfig(configId) : null
}

/** Deletes a config (nothing refers to one); false when it does not exist. */
export async function deletePerfectStoreConfig(configId: number): Promise<boolean> {
  await ensureSchema()
  const result = await getDb().prepare("DELETE FROM perfect_store_configs WHERE id = @id").run({ id: configId })
  return result.changes > 0
}
