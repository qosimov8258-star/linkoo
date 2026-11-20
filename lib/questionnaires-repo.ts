import "server-only"

import { NextResponse } from "next/server"
import { z } from "zod"

import { dbErrorResponse } from "@/lib/db-errors"
import { formatStatementDate, nowLocalIso } from "@/lib/finance/dates"
import { listClientTypes } from "@/lib/client-types-repo"
import { getDb, outsideTransaction } from "@/lib/db"
import { listOrganizations } from "@/lib/organizations-repo"
import { nameKey } from "@/lib/platform-refs"

// "Опросник" (/analytics/surveys). A survey optionally belongs to one of the factory's own organizations
// (/api/organizations; the reference leaves it empty on several surveys) and optionally to one client type (/api/client-types; none =
// "Не указано"): surveys.organization_id / client_type_id, validated on every write (400
// "Организация не найдена" / "Тип клиента не найден"). organization / store_type keep the names (the
// organization rename cascade and delete check of lib/organizations-repo.ts find surveys by them);
// reads show the current names of linked ones. The Excel import may send the names instead.
// The survey form's sequence number (orderNo), its four switches (flags) and its questions are
// stored with the survey (surveys.order_no / flags / questions, JSON); an update that omits them
// keeps the stored ones.

/** A product picked for a "Продукт" / "Инвентарь" / "Планограмма" question (its name as it was when saved). */
export type SurveyProduct = { id: number; name: string }

export type SurveyQuestion = {
  text: string
  type: string
  maxAnswers: string
  format: string
  orderNo: string
  required: boolean
  answers: string[]
  /** «Оценка» of each answer (same order as `answers`) when the survey has a scoring system; "" = none. */
  balls: string[]
  /** "Продукт": Face check / Price check / Продукт конкурента and the «Список товаров» (own or rival products). */
  checkAmount: boolean
  checkPrice: boolean
  isRival: boolean
  products: SurveyProduct[]
  rivalProducts: SurveyProduct[]
  /** Perfect Store questions: «Минимальное количество» (Инвентарь), «ID планограммы» (Планограмма) and their switches. */
  minimumQuantity: string
  planogramId: string
  fullyOutOfStock: boolean
  allProductsHavePriceTag: boolean
  requirePlanogramExistsInStore: boolean
}

export type SurveyFlags = { required: boolean; storeCheck: boolean; scoring: boolean; perfect: boolean }

/** Question types and answer formats of the survey form (components/analytics/survey-form.tsx); "" = not chosen. */
const QUESTION_TYPES = ["Выбрать одну", "Выбрать несколько", "Вводит текст", "Продукт", "Инвентарь", "Планограмма"] as const
const QUESTION_FORMATS = ["Текст", "Число"] as const
const NO_FLAGS: SurveyFlags = { required: false, storeCheck: false, scoring: false, perfect: false }

export type Survey = {
  id: number
  name: string
  createdAt: string
  /** The creation day (YYYY-MM-DD) for the «Период создания» filter. */
  createdOn: string
  active: boolean
  organization: string
  /** null = a survey saved before surveys were linked by id (only the name is known). */
  organizationId: number | null
  /** Client type name ("" = not set). */
  storeType: string
  clientTypeId: number | null
  comment: string
  orderNo: string
  flags: SurveyFlags
  questions: SurveyQuestion[]
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
  order_no: string | null
  flags: string | null
  questions: string | null
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
      await db.exec(
        `ALTER TABLE surveys ADD COLUMN IF NOT EXISTS organization_id INTEGER, ADD COLUMN IF NOT EXISTS client_type_id INTEGER,
           ADD COLUMN IF NOT EXISTS order_no TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS flags TEXT NOT NULL DEFAULT '{}',
           ADD COLUMN IF NOT EXISTS questions TEXT NOT NULL DEFAULT '[]'`,
      )
    }).catch((error) => {
      globalThis.__linkoSurveysSchema = undefined
      throw error
    })
  }
  return globalThis.__linkoSurveysSchema
}

function formatDate(iso: string): string {
  // The stored digits as they are ("YYYY-MM-DD HH:MM:SS"), as the reference prints them: "30 сент. 2025, 16:09",
  // with moment's month forms ("июня", "июля").
  const text = String(iso ?? "").replace(" ", "T")
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) ? formatStatementDate(text.slice(0, 16), "ru", true) : iso
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

function parseJson(text: string | null | undefined): unknown {
  try {
    return JSON.parse(text || "null")
  } catch {
    return null
  }
}

/** Stored switches (anything else reads as all off). */
function readFlags(text: string | null | undefined): SurveyFlags {
  const value = parseJson(text)
  const flags = (value && typeof value === "object" ? value : {}) as Record<string, unknown>
  return { required: flags.required === true, storeCheck: flags.storeCheck === true, scoring: flags.scoring === true, perfect: flags.perfect === true }
}

/** Stored questions (anything that is not a question list reads as none). */
function readQuestions(text: string | null | undefined): SurveyQuestion[] {
  const value = parseJson(text)
  if (!Array.isArray(value)) return []
  const str = (item: unknown) => (typeof item === "string" ? item : "")
  const products = (list: unknown): SurveyProduct[] =>
    Array.isArray(list)
      ? list.flatMap((item) => {
          const id = Number((item as SurveyProduct | null)?.id)
          return Number.isSafeInteger(id) && id > 0 ? [{ id, name: str((item as SurveyProduct).name) }] : []
        })
      : []
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((question) => ({
      text: str(question.text),
      type: str(question.type),
      maxAnswers: str(question.maxAnswers),
      format: str(question.format),
      orderNo: str(question.orderNo),
      required: question.required === true,
      answers: Array.isArray(question.answers) ? question.answers.map(str) : [],
      balls: Array.isArray(question.balls) ? question.balls.map(str) : [],
      checkAmount: question.checkAmount === true,
      checkPrice: question.checkPrice === true,
      isRival: question.isRival === true,
      products: products(question.products),
      rivalProducts: products(question.rivalProducts),
      minimumQuantity: str(question.minimumQuantity),
      planogramId: str(question.planogramId),
      fullyOutOfStock: question.fullyOutOfStock === true,
      allProductsHavePriceTag: question.allProductsHavePriceTag === true,
      requirePlanogramExistsInStore: question.requirePlanogramExistsInStore === true,
    }))
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
    createdOn: /^\d{4}-\d{2}-\d{2}/.test(String(row.created_at ?? "")) ? String(row.created_at).slice(0, 10) : "",
    active: !!row.active,
    organization: (organizationId !== null ? refs.organizations.get(organizationId) : undefined) ?? row.organization ?? "",
    organizationId,
    storeType: (clientTypeId !== null ? refs.clientTypes.get(clientTypeId) : undefined) ?? (NOT_SET.has(nameKey(row.store_type ?? "")) ? "" : row.store_type),
    clientTypeId,
    comment: row.comment ?? "",
    orderNo: row.order_no ?? "",
    flags: readFlags(row.flags),
    questions: readQuestions(row.questions),
  }
}

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

const id = z.number().int().positive().max(2_147_483_647)

/** A sequence number of the form: "" or a whole number (up to 9 digits). */
const sequence = z.string().trim().regex(/^\d{0,9}$/, { error: "Введите целое число" })

/** A picked product: its id (checked against the catalogue on save) and the name shown in the list. */
const productSchema = z.object({ id, name: z.string().max(500, "Не более 500 символов").optional() })

const questionSchema = z.object({
  text: z.string().trim().max(1000, "Не более 1000 символов"),
  type: z.union([z.enum(QUESTION_TYPES), z.literal("")], { error: "Неверное значение" }),
  maxAnswers: sequence,
  format: z.union([z.enum(QUESTION_FORMATS), z.literal("")], { error: "Неверное значение" }),
  orderNo: sequence,
  required: z.boolean(),
  answers: z.array(z.string().trim().max(500, "Не более 500 символов")).max(200, "Слишком много значений"),
  balls: z.array(z.string().trim().regex(/^-?\d{0,9}([.,]\d{0,4})?$/, { error: "Введите число" })).max(200, "Слишком много значений").optional(),
  checkAmount: z.boolean().optional(),
  checkPrice: z.boolean().optional(),
  isRival: z.boolean().optional(),
  products: z.array(productSchema).max(500, "Слишком много значений").optional(),
  rivalProducts: z.array(productSchema).max(500, "Слишком много значений").optional(),
  minimumQuantity: sequence.optional(),
  planogramId: z.string().trim().max(255, "Не более 255 символов").optional(),
  fullyOutOfStock: z.boolean().optional(),
  allProductsHavePriceTag: z.boolean().optional(),
  requirePlanogramExistsInStore: z.boolean().optional(),
})

/** POST / PUT body. organizationId (or the organization name) and clientTypeId / storeType are optional (null / "" = none). */
export const surveyBodySchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(255, "Не более 255 символов"),
  active: z.boolean().optional(),
  organizationId: id.nullish(),
  organization: z.string().trim().max(255, "Не более 255 символов").optional(),
  clientTypeId: id.nullish(),
  storeType: z.string().trim().max(255, "Не более 255 символов").optional(),
  comment: z.string().max(2000, "Не более 2000 символов").optional(),
  orderNo: sequence.optional(),
  flags: z
    .object({ required: z.boolean(), storeCheck: z.boolean(), scoring: z.boolean(), perfect: z.boolean() })
    .partial()
    .optional(),
  questions: z.array(questionSchema).max(200, "Слишком много значений").optional(),
})

export type SurveyBody = z.infer<typeof surveyBodySchema>

type SurveyValues = {
  name: string
  active: boolean
  /** null = no organization (the reference's «Организация» may stay empty). */
  organizationId: number | null
  organization: string
  clientTypeId: number | null
  storeType: string
  comment: string
}

type QuestionBody = NonNullable<SurveyBody["questions"]>[number]

/** Names of the catalogue's products / rival products by id (unknown ids are left out). */
async function productNames(table: "products" | "rival_products", ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map()
  const exists = (await getDb().prepare(`SELECT to_regclass('${table}') IS NOT NULL AS ok`).get()) as { ok: boolean } | undefined
  if (!exists?.ok) return new Map()
  const rows = (await getDb().prepare(`SELECT id, name FROM ${table} WHERE id = ANY(@ids::int[])`).all({ ids })) as Array<{ id: number; name: string }>
  return new Map(rows.map((row) => [Number(row.id), String(row.name ?? "")]))
}

/** The questions as stored: every field present, picked products checked against the catalogue (with their names). */
async function storedQuestions(questions: QuestionBody[]): Promise<SurveyQuestion[]> {
  const own = await productNames("products", [...new Set(questions.flatMap((question) => (question.products ?? []).map((item) => item.id)))])
  const rival = await productNames("rival_products", [...new Set(questions.flatMap((question) => (question.rivalProducts ?? []).map((item) => item.id)))])
  const pick = (list: QuestionBody["products"], names: Map<number, string>): SurveyProduct[] => {
    const seen = new Set<number>()
    return (list ?? []).flatMap((item) => (names.has(item.id) && !seen.has(item.id) && seen.add(item.id) ? [{ id: item.id, name: names.get(item.id)! }] : []))
  }
  return questions.map((question) => ({
    text: question.text,
    type: question.type,
    maxAnswers: question.maxAnswers,
    format: question.format,
    orderNo: question.orderNo,
    required: question.required,
    answers: question.answers,
    balls: (question.balls ?? []).slice(0, question.answers.length).map((ball) => ball.replace(",", ".")),
    checkAmount: question.checkAmount ?? false,
    checkPrice: question.checkPrice ?? false,
    isRival: question.isRival ?? false,
    products: pick(question.products, own),
    rivalProducts: pick(question.rivalProducts, rival),
    minimumQuantity: question.minimumQuantity ?? "",
    planogramId: question.planogramId ?? "",
    fullyOutOfStock: question.fullyOutOfStock ?? false,
    allProductsHavePriceTag: question.allProductsHavePriceTag ?? false,
    requirePlanogramExistsInStore: question.requirePlanogramExistsInStore ?? false,
  }))
}

/** The form fields kept as they are: orderNo / flags / questions (an omitted one keeps `current`). */
async function formParams(body: SurveyBody, current?: Row) {
  return {
    orderNo: body.orderNo ?? current?.order_no ?? "",
    flags: JSON.stringify(body.flags ? { ...NO_FLAGS, ...body.flags } : current ? readFlags(current.flags) : NO_FLAGS),
    questions: JSON.stringify(body.questions ? await storedQuestions(body.questions) : current ? readQuestions(current.questions) : []),
  }
}

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
    organization: organizationId === null ? "" : refs.organizations.get(organizationId)!,
    clientTypeId,
    storeType: clientTypeId === null ? "" : refs.clientTypes.get(clientTypeId)!,
    comment: body.comment ?? "",
  }
}

// ---------------------------------------------------------------------------
// Reads / writes
// ---------------------------------------------------------------------------

/** The reference's list order: by the sequence number (surveys without one last), then the newest first. */
const LIST_ORDER = "CASE WHEN order_no ~ '^[0-9]{1,9}$' THEN CAST(order_no AS INTEGER) END ASC NULLS LAST, id DESC"

export async function listSurveys(): Promise<Survey[]> {
  await ensureSchema()
  const [rows, refs] = await Promise.all([getDb().prepare(`SELECT * FROM surveys ORDER BY ${LIST_ORDER}`).all() as Promise<Row[]>, directory()])
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
      `INSERT INTO surveys (name, active, organization, organization_id, store_type, client_type_id, comment, order_no, flags, questions, created_at, updated_at)
       VALUES (@name, @active, @organization, @organizationId, @storeType, @clientTypeId, @comment, @orderNo, @flags, @questions, @createdAt, @createdAt)`,
    )
    // The creation time is the local (Asia/Tashkent) wall clock, like the reference's (and the imported surveys').
    .run({ ...params(values), ...(await formParams(body)), createdAt: nowLocalIso().replace("T", " ") })
  return (await getSurvey(Number(result.lastInsertRowid)))!
}

export async function updateSurvey(surveyId: number, body: SurveyBody): Promise<Survey | null> {
  await ensureSchema()
  const current = (await getDb().prepare("SELECT * FROM surveys WHERE id = ?").get(surveyId)) as Row | undefined
  if (!current) return null
  const values = await surveyValues(body)
  await getDb()
    .prepare(
      `UPDATE surveys SET name = @name, active = @active, organization = @organization, organization_id = @organizationId,
         store_type = @storeType, client_type_id = @clientTypeId, comment = @comment, order_no = @orderNo, flags = @flags,
         questions = @questions, updated_at = datetime('now') WHERE id = @id`,
    )
    .run({ ...params(values), ...(await formParams(body, current)), id: surveyId })
  return getSurvey(surveyId)
}

export async function deleteSurvey(surveyId: number): Promise<boolean> {
  await ensureSchema()
  return (await getDb().prepare("DELETE FROM surveys WHERE id = ?").run(surveyId)).changes > 0
}
