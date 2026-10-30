import "server-only"

import { z, type ZodType } from "zod"

import { getClient } from "@/lib/clients-repo"
import { getDb, outsideTransaction, withTransaction } from "@/lib/db"
import { parseDocDay } from "@/lib/document-dates"
import { nowLocalIso } from "@/lib/finance/dates"
import { MAX_DB_ID, NOT_A_NUMBER, strictNumber } from "@/lib/strict-number"

// Generic JSON document store for the "Продажи" pages that mirror the reference app's lists (returns, promotions,
// mailings, surveys, ...). Each page keeps its own row shape in `data`; rows are soft-deleted so a cancelled record
// never reappears from a seed and nothing is ever physically removed.

// Kinds no page reads any more ("return" / "return-detail": client returns live in client_returns;
// "refusal" / "photo": refusals and photo reports come from the field data) are not listed: their
// legacy rows stay in the table, unread.
export const REF_KINDS = ["promo", "mailing", "survey", "survey-plan", "bonus", "gear", "tg-page", "draft-order", "shift"] as const
export type RefKind = (typeof REF_KINDS)[number]

/** Lists the reference shows newest (highest id) first; the other lists keep their stored order. */
const NEWEST_FIRST: RefKind[] = ["promo", "mailing", "draft-order"]

export type RefRecord<T = Record<string, unknown>> = { id: string; data: T }

export function isRefKind(value: string): value is RefKind {
  return (REF_KINDS as readonly string[]).includes(value)
}

/** A live record with this (kind, id) already exists (409). */
export class RefRecordConflictError extends Error {
  constructor() {
    super("Запись с таким номером уже существует")
    this.name = "RefRecordConflictError"
  }
}

type Row = { id: string; data: string }

// --- schema ------------------------------------------------------------------------------------------------------------
// Created once per process on the maintenance pool (outsideTransaction), never inside a request's transaction.

const DDL = `
  CREATE TABLE IF NOT EXISTS ref_records (
    seq BIGINT GENERATED ALWAYS AS IDENTITY,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (kind, id)
  );
`

declare global {
  var __linkoRefRecordsSchema: Promise<void> | undefined
}

function ensureSchema(): Promise<void> {
  if (!globalThis.__linkoRefRecordsSchema) {
    globalThis.__linkoRefRecordsSchema = outsideTransaction(() => getDb().exec(DDL)).catch((error: unknown) => {
      globalThis.__linkoRefRecordsSchema = undefined
      throw error
    })
  }
  return globalThis.__linkoRefRecordsSchema
}

/** Stored JSON → the row's object; a damaged value (not a JSON object) is left out instead of failing the list. */
function parseData(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** A numeric id the database can cast (ids longer than 18 digits would overflow BIGINT and fail the whole list). */
const NUMERIC_ID_SQL = "id ~ '^[0-9]{1,18}$'"

// --- store -------------------------------------------------------------------------------------------------------------

/** Records in the order the reference list shows them: the physical insertion order (seeds keep the reference order). */
export async function listRecords(kind: RefKind): Promise<RefRecord[]> {
  await ensureSchema()
  const order = NEWEST_FIRST.includes(kind) ? `CASE WHEN ${NUMERIC_ID_SQL} THEN CAST(id AS BIGINT) END DESC NULLS LAST, seq DESC` : `seq ASC`
  const rows = (await getDb().prepare(`SELECT id, data FROM ref_records WHERE kind = ? AND deleted = 0 ORDER BY ${order}`).all(kind)) as Row[]
  return rows.flatMap((row) => {
    const data = parseData(row.data)
    return data ? [{ id: row.id, data }] : []
  })
}

export async function getRecord(kind: RefKind, id: string): Promise<RefRecord | null> {
  await ensureSchema()
  const row = (await getDb().prepare(`SELECT id, data FROM ref_records WHERE kind = ? AND id = ? AND deleted = 0`).get(kind, id)) as Row | undefined
  const data = row ? parseData(row.data) : null
  return row && data ? { id: row.id, data } : null
}

/**
 * New record. Without `id` it gets the next number of its kind (max numeric id + 1, the reference numbers new documents
 * the same way); the kind's advisory lock makes two parallel creates take different numbers. With `id` (a record keyed by
 * another table's id, e.g. a client's bonus) a soft-deleted record of that id is brought back; a live one throws
 * RefRecordConflictError.
 */
export async function createRecord(kind: RefKind, data: Record<string, unknown>, id?: string): Promise<RefRecord> {
  await ensureSchema()
  return withTransaction(async (tx) => {
    let nextId = id
    if (!nextId) {
      await tx.prepare("SELECT pg_advisory_xact_lock(hashtext(@key)) AS ok").get({ key: `linko:ref_records:${kind}` })
      const row = (await tx
        .prepare(`SELECT COALESCE(MAX(CAST(id AS BIGINT)), 0) AS max FROM ref_records WHERE kind = ? AND ${NUMERIC_ID_SQL}`)
        .get(kind)) as { max: number | string } | undefined
      nextId = String(Number(row?.max ?? 0) + 1)
    }
    const stored = { ...data, id: /^\d{1,15}$/.test(nextId) ? Number(nextId) : nextId }
    const result = await tx
      .prepare(
        `INSERT INTO ref_records (kind, id, data) VALUES (@kind, @id, @data)
           ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data, deleted = 0, updated_at = datetime('now')
           WHERE ref_records.deleted = 1
         RETURNING id`,
      )
      .get({ kind, id: nextId, data: JSON.stringify(stored) })
    if (!result) throw new RefRecordConflictError()
    return { id: nextId, data: stored }
  })
}

/** Merges `patch` into a live record (the row is locked, so parallel edits of different fields both stay). */
export async function updateRecord(kind: RefKind, id: string, patch: Record<string, unknown>): Promise<RefRecord | null> {
  await ensureSchema()
  return withTransaction(async (tx) => {
    const row = (await tx.prepare(`SELECT id, data FROM ref_records WHERE kind = ? AND id = ? AND deleted = 0 FOR UPDATE`).get(kind, id)) as Row | undefined
    const current = row ? parseData(row.data) : null
    if (!current) return null
    const data = { ...current, ...patch, id: current.id }
    await tx.prepare(`UPDATE ref_records SET data = ?, updated_at = datetime('now') WHERE kind = ? AND id = ?`).run(JSON.stringify(data), kind, id)
    return { id, data }
  })
}

export async function deleteRecord(kind: RefKind, id: string): Promise<boolean> {
  await ensureSchema()
  const result = await getDb().prepare(`UPDATE ref_records SET deleted = 1, updated_at = datetime('now') WHERE kind = ? AND id = ? AND deleted = 0`).run(kind, id)
  return result.changes > 0
}

// --- generic API (/api/ref-records/<kind>[/<id>]) -----------------------------------------------------------------------
// Only the kinds a page reads or writes through the generic API are served there, and only with the methods that page
// uses. Kinds with an API of their own (tg-page → /api/telegram-bot-pages, survey-plan → /api/survey-plans) and kinds no
// page uses any more (refusal and photo: the photo reports and refusals now come from the field data) are not reachable,
// so their own validation cannot be bypassed. The permission each kind's writes
// need is mapped in lib/capabilities-catalog.ts (/api/ref-records/<kind>); reads are open to every signed-in user, like
// the rest of the app's lists.

export type RefApiMethod = "POST" | "PUT" | "DELETE"

/** Largest stored record (JSON bytes); a mailing carries its photo as a data URL, so it may be larger. */
export const REF_DATA_MAX_BYTES = 64 * 1024
const MAILING_MAX_BYTES = 1536 * 1024
/** Largest absolute number stored in a record (the money bound of the app). */
const MAX_ABS_NUMBER = 1e13
const MAX_DEPTH = 16
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])

const text = (max: number) => z.string().trim().min(1, "Обязательное поле").max(max, "Слишком длинное значение")
/** A day of a plan-like document (may be in the future): canonical "YYYY-MM-DD". */
const planDay = z.string().transform((value, ctx) => {
  const parsed = parseDocDay(value, { allowFuture: true })
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.error })
    return z.NEVER
  }
  return parsed.date
})
/** A day something already happened (never after today, Asia/Tashkent): canonical "YYYY-MM-DD". */
const pastDay = z.string().transform((value, ctx) => {
  const parsed = parseDocDay(value)
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.error })
    return z.NEVER
  }
  return parsed.date
})
const points = z.number({ error: "Введите число" }).refine((value) => Number.isFinite(value) && Math.abs(value) <= MAX_ABS_NUMBER, "Слишком большое значение")
const IMAGE_DATA_URL = /^data:image\/[a-z0-9.+-]{1,40};base64,[A-Za-z0-9+/]+={0,2}$/

/** A number field the forms keep as typed text: empty, or a plain decimal ("12", "1 000,5"; lib/strict-number.ts) in range. */
const formNumber = (min: number, max: number, options: { exclusiveMin?: boolean } = {}) =>
  z
    .string()
    .max(100, "Слишком длинное значение")
    .refine((value) => !value.trim() || !Number.isNaN(strictNumber(value, { locale: true })), NOT_A_NUMBER)
    .refine((value) => {
      if (!value.trim()) return true
      const number = strictNumber(value, { locale: true })
      return Number.isNaN(number) || ((options.exclusiveMin ? number > min : number >= min) && number <= max)
    }, "Неверное значение")
const label = z.string().max(255, "Слишком длинное значение")
const percent = formNumber(0, 100)
const count = formNumber(0, 1e9, { exclusiveMin: true })

// "Маркетинговые акции": the page lists name / start / end / type / active and keeps the "Новая акция" form's settings in
// `config` (components/orders/promo-form.tsx PromoFormValue); nothing else is stored.
/** The promotion types the form offers (promo-form.tsx PromoType); the list and its filter show them through t(). */
const PROMO_TYPES = ["Скидка", "Бонус", "Надбавка", "Балл", "Кэшбэк"] as const
const promoType = z.enum(PROMO_TYPES, "Неверное значение")
const promoConfig = z.strictObject({
  type: promoType,
  calc: label,
  addMode: label,
  audience: label,
  cashbackBase: label,
  /** A currency of Валюты by its name (the form offers /api/currencies); checked in promoCheck. Empty = not chosen. */
  currency: label,
  conditions: z.array(label).max(50, "Неверные данные"),
  purchase: z.strictObject({ bonusSame: z.boolean(), block: z.boolean(), combo: z.boolean(), perItem: z.boolean(), qty: count }),
  gift: z.strictObject({ once: z.boolean(), fund: count }),
  allProducts: z.boolean(),
  cashbackPercent: percent,
  extraFrom: formNumber(0, MAX_ABS_NUMBER),
  extraPercent: percent,
})
const promoCreate = z
  .strictObject({
    name: text(255),
    start: planDay,
    end: planDay,
    type: promoType,
    active: z.boolean(),
    config: promoConfig.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.end < value.start) ctx.addIssue({ code: "custom", message: "Дата завершения раньше даты начала", path: ["end"] })
    if (value.config && value.config.type !== value.type) ctx.addIssue({ code: "custom", message: "Неверное значение", path: ["config", "type"] })
  })

/** The promotion's currency is one of Валюты (by the name the form shows). */
async function promoCheck(data: Record<string, unknown>): Promise<ApiIssue | null> {
  const config = data.config as { currency?: string } | undefined
  const currency = config?.currency?.trim()
  if (!currency) return null
  const known = await getDb().prepare("SELECT 1 AS ok FROM currencies WHERE btrim(name) = ? LIMIT 1").get(currency)
  return known ? null : { status: 400, error: "Валюта не найдена", field: "config.currency" }
}

// "Рассылка": a new mailing is a draft nobody received yet; its moment, status and counters are the server's
// (Asia/Tashkent), whatever the page sends for them; nothing else is stored.
const mailingCreate = z
  .strictObject({
    message: text(4096),
    debt: z.boolean().default(false),
    photo: z.string().regex(IMAGE_DATA_URL, "Неверный формат").nullish(),
    createdAt: z.unknown().optional(),
    createdAtDetail: z.unknown().optional(),
    status: z.unknown().optional(),
    sent: z.unknown().optional(),
    blocked: z.unknown().optional(),
  })
  .transform(({ message, debt, photo }) => {
    const now = nowLocalIso().slice(0, 16)
    return { message, debt, photo, createdAt: now.slice(0, 10), createdAtDetail: now, status: "Черновик", sent: 0, blocked: 0 }
  })

// "Бонусы клиентов": one record per client (id = the client's id) with its points and the day of the last score.
const bonusCreate = z.strictObject({ name: z.string().max(500).optional(), points, lastScore: pastDay })
const bonusUpdate = z
  .strictObject({ points: points.optional(), lastScore: pastDay.optional() })
  .refine((value) => value.points !== undefined || value.lastScore !== undefined, "Неверные данные")

type KindApi = {
  create?: ZodType<Record<string, unknown>>
  /** Checks of a new record against other tables (after its schema). */
  check?: (data: Record<string, unknown>) => Promise<ApiIssue | null>
  update?: ZodType<Record<string, unknown>>
  remove?: boolean
  /** The id of a new record is another table's id the caller names (bonus: the client). */
  keyedByClient?: boolean
  maxBytes?: number
}

const API: Partial<Record<RefKind, KindApi>> = {
  "draft-order": {},
  gear: {},
  promo: { create: promoCreate, check: promoCheck },
  mailing: { create: mailingCreate, maxBytes: MAILING_MAX_BYTES },
  bonus: { create: bonusCreate, update: bonusUpdate, keyedByClient: true },
}

/** Kinds the generic API serves (others answer 404 there). */
export function apiKind(value: string): RefKind | null {
  return isRefKind(value) && API[value] ? value : null
}

/** True when the generic API lets `method` change records of `kind`. */
export function apiAllows(kind: RefKind, method: RefApiMethod): boolean {
  const api = API[kind]
  if (!api) return false
  return method === "POST" ? Boolean(api.create) : method === "PUT" ? Boolean(api.update) : Boolean(api.remove)
}

export function apiMaxBytes(kind: RefKind): number {
  return API[kind]?.maxBytes ?? REF_DATA_MAX_BYTES
}

/** A record id of a route or a body: a positive int4 ("7"; no sign, point or leading zero) or a short code ("total"). */
export function parseRecordId(value: unknown): string | null {
  const raw = typeof value === "number" && Number.isInteger(value) ? String(value) : typeof value === "string" ? value : ""
  if (/^[1-9]\d{0,9}$/.test(raw)) return Number(raw) <= MAX_DB_ID ? raw : null
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(raw) ? raw : null
}

export type ApiIssue = { status: number; error: string; field?: string | null }

/** Refuses what no page stores: a key that could reach an object's prototype, numbers that are not finite or beyond the
 * money bound, and nesting deeper than any page uses. */
export function unsafeJsonIssue(value: unknown, path = "", depth = 0): ApiIssue | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && Math.abs(value) <= MAX_ABS_NUMBER ? null : { status: 400, error: "Слишком большое значение", field: path || null }
  }
  if (value === null || typeof value !== "object") return null
  if (depth >= MAX_DEPTH) return { status: 400, error: "Неверные данные", field: path || null }
  const entries: [string, unknown][] = Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value)
  for (const [key, item] of entries) {
    const itemPath = path ? `${path}.${key}` : key
    if (!Array.isArray(value) && FORBIDDEN_KEYS.has(key)) return { status: 400, error: "Неверные данные", field: itemPath }
    const issue = unsafeJsonIssue(item, itemPath, depth + 1)
    if (issue) return issue
  }
  return null
}

function sizeIssue(kind: RefKind, data: unknown): ApiIssue | null {
  return Buffer.byteLength(JSON.stringify(data), "utf8") > apiMaxBytes(kind) ? { status: 413, error: "Слишком большой запрос" } : null
}

function schemaIssue(error: z.ZodError): ApiIssue {
  const first = error.issues[0]
  const message = first?.message && /[А-Яа-яЁё]/.test(first.message) ? first.message : "Неверные данные"
  // An unknown key names itself as the field.
  const path = first ? [...first.path.map(String), ...(first.code === "unrecognized_keys" ? first.keys.slice(0, 1) : [])] : []
  return { status: 400, error: message, field: path.join(".") || null }
}

export type ApiResult = { ok: true; record: RefRecord } | { ok: false; issue: ApiIssue }

/** POST /api/ref-records/<kind>: `body` is the page's row (already text-cleaned, see lib/validation.ts cleanJsonText). */
export async function apiCreate(kind: RefKind, body: Record<string, unknown>): Promise<ApiResult> {
  const api = API[kind]
  if (!api?.create) return { ok: false, issue: { status: 405, error: "Действие недоступно" } }
  const { id: bodyId, ...rest } = body
  let id: string | undefined
  let extra: Record<string, unknown> = {}
  if (api.keyedByClient) {
    const parsedId = parseRecordId(bodyId)
    if (!parsedId || !/^\d+$/.test(parsedId)) return { ok: false, issue: { status: 400, error: "Неверный идентификатор", field: "id" } }
    const client = await getClient(Number(parsedId), { withBalances: false })
    if (!client) return { ok: false, issue: { status: 400, error: "Клиент не найден", field: "id" } }
    id = parsedId
    extra = { name: client.name }
  } else if (bodyId !== undefined && bodyId !== null) {
    // Numbers of new documents are given by the server.
    return { ok: false, issue: { status: 400, error: "Неверный идентификатор", field: "id" } }
  }
  const unsafe = unsafeJsonIssue(rest)
  if (unsafe) return { ok: false, issue: unsafe }
  const parsed = api.create.safeParse(rest)
  if (!parsed.success) return { ok: false, issue: schemaIssue(parsed.error) }
  const data = { ...parsed.data, ...extra }
  const tooBig = sizeIssue(kind, data)
  if (tooBig) return { ok: false, issue: tooBig }
  const refused = api.check ? await api.check(data) : null
  if (refused) return { ok: false, issue: refused }
  try {
    return { ok: true, record: await createRecord(kind, data, id) }
  } catch (error) {
    if (error instanceof RefRecordConflictError) return { ok: false, issue: { status: 409, error: error.message, field: "id" } }
    throw error
  }
}

/** PUT /api/ref-records/<kind>/<id>: merges the validated patch; null record = unknown id (404). */
export async function apiUpdate(kind: RefKind, id: string, body: Record<string, unknown>): Promise<ApiResult | null> {
  const api = API[kind]
  if (!api?.update) return { ok: false, issue: { status: 405, error: "Действие недоступно" } }
  const unsafe = unsafeJsonIssue(body)
  if (unsafe) return { ok: false, issue: unsafe }
  const parsed = api.update.safeParse(body)
  if (!parsed.success) return { ok: false, issue: schemaIssue(parsed.error) }
  const current = await getRecord(kind, id)
  if (!current) return null
  const tooBig = sizeIssue(kind, { ...current.data, ...parsed.data })
  if (tooBig) return { ok: false, issue: tooBig }
  const record = await updateRecord(kind, id, parsed.data)
  return record ? { ok: true, record } : null
}
