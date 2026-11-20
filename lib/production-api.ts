import "server-only"

import { NextResponse } from "next/server"
import { z, type ZodType } from "zod"

import { canReadPurchases } from "@/lib/company-money"
import { dbErrorResponse } from "@/lib/db-errors"
import { getCurrentUser } from "@/lib/current-user"
import { docYearOk } from "@/lib/document-dates"
import { isIsoDay } from "@/lib/finance/dates"
import { isProductionError, parseItemKey } from "@/lib/production-schema"
import { equipmentSchema, staffSchema, staffUpdateSchema } from "@/lib/production-staffeq-schemas"
import { cleanJsonText, NOT_JSON_MESSAGE, notSignedInResponse, type ParsedBody, parseIdSegment, zodErrorBody } from "@/lib/validation"
import { dbId, strictNum } from "@/lib/strict-number"

export type RouteParams = { params: Promise<{ id: string }> }

/** Route id → positive int4 (canonical digits only), else null (→ 404, never a 500). */
export async function routeId({ params }: RouteParams): Promise<number | null> {
  return parseIdSegment((await params).id)
}

export async function requireViewer() {
  const user = await getCurrentUser()
  return user ? null : notSignedInResponse()
}

// ACCESS: who reads production and its costs. Like every other section of the app, any signed-in user reads the
// production pages (only the writes need production.manage, lib/capabilities-catalog.ts). What the goods cost follows
// the rule of Склад → Себестоимость (/api/cost-of-goods answers 403 to anyone else): lib/company-money.ts
// canReadPurchases — the readers of company money and the holders of procurement, stock, production or catalogue
// rights. The others (agents, deliverers…) read the quantities without the cost figures.

export type ProductionReader = { canSeeCost: boolean; error?: undefined } | { canSeeCost?: undefined; error: NextResponse }

/** The signed-in reader of a production page (401 otherwise) and whether they may see what the goods cost. */
export async function requireProductionReader(): Promise<ProductionReader> {
  const user = await getCurrentUser()
  if (!user) return { error: notSignedInResponse() }
  return { canSeeCost: canReadPurchases(user) }
}

/** Fields of a line that carry what the goods cost: a batch line's / summary's cost and total, a picker item's cost. */
const COST_FIELD = /cost|price|^total$|^sum$|^value$/i

function withoutCostFields(line: unknown): unknown {
  if (!line || typeof line !== "object" || Array.isArray(line)) return line
  return Object.fromEntries(Object.entries(line).map(([key, value]) => [key, COST_FIELD.test(key) ? null : value]))
}

/** A batch detail as its reader may see it: unchanged for a reader of costs; for anyone else every cost figure is
 * null (each line's and summary's cost and total, the batch's totalRawCost). `canSeeCost` tells the page whether
 * to show the Себестоимость / Сумма columns and the Итого. */
export function withCostVisibility(data: object, canSeeCost: boolean): Record<string, unknown> & { canSeeCost: boolean } {
  if (canSeeCost) return { ...data, canSeeCost }
  const shown: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) shown[key] = Array.isArray(value) ? value.map(withoutCostFields) : /cost/i.test(key) ? null : value
  return { ...shown, canSeeCost }
}

/** Picker items (GET /api/production/items) as their reader may see them: without the unit cost for a reader who
 * may not see costs. */
export function itemsWithCostVisibility(items: readonly object[], canSeeCost: boolean): unknown[] {
  return canSeeCost ? [...items] : items.map(withoutCostFields)
}

export function errorResponse(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status })
}

export const notFound = (message = "Запись не найдена") => errorResponse(message, 404)

/** Query id → positive int4 (canonical digits only), else undefined (ignored). */
export function positiveIntParam(value: string | null): number | undefined {
  return parseIdSegment(value?.trim()) ?? undefined
}

/** A refused request (ProductionError from the repos) or a database
 * constraint the repos did not pre-check → a clean 4xx instead of an empty 500. */
export function routeError(error: unknown): NextResponse {
  if (isProductionError(error)) return errorResponse(error.message, error.status, error.details)
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined
  if (code === "23503") return errorResponse("Связанная запись не найдена", 400)
  if (code === "23505") return errorResponse("Такая запись уже существует", 409)
  if (code === "22P02" || code === "22003" || code === "22001") return errorResponse("Неверные данные", 400)
  const busy = dbErrorResponse(error)
  if (busy) return busy
  throw error
}

/** Runs a route body and maps refusals to their HTTP response. */
export async function guarded(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler()
  } catch (error) {
    return routeError(error)
  }
}

/** parseJsonBody twin that answers with the first Russian validation message
 * (e.g. "Неверная дата") instead of the generic "Неверные данные". */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<ParsedBody<T>> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return { error: errorResponse(NOT_JSON_MESSAGE) }
  }
  // Zero-width / bidi characters are dropped from every text; NUL and broken Unicode answer 400.
  const cleaned = cleanJsonText(json)
  if (cleaned.issue) return { error: errorResponse(cleaned.issue.message, 400, { field: cleaned.issue.field || null }) }
  const result = schema.safeParse(cleaned.value)
  if (!result.success) {
    const body = zodErrorBody(result.error)
    return { error: errorResponse(body.error, 400, { field: body.field, details: body.details }) }
  }
  return { data: result.data }
}

/** Upper bound of every quantity (contract: 0 < qty ≤ 1e9). */
export const MAX_QTY = 1e9

const DATE_ERROR = "Неверная дата"
/** A real calendar day "YYYY-MM-DD" (2026-13-45 and 2026-02-31 are refused). */
const dateString = z
  .string({ error: DATE_ERROR })
  // `abort`: a value that is no "YYYY-MM-DD" at all («17.11.2026») is reported once, not twice.
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: DATE_ERROR, abort: true })
  // A real day of a sane year (2000..2100, lib/document-dates.ts).
  .refine((value) => isIsoDay(value) && docYearOk(value), DATE_ERROR)
const QTY_ERROR = "Количество должно быть больше 0 и не больше 1 000 000 000"
const amount = strictNum(z.number({ error: QTY_ERROR }).finite(QTY_ERROR).positive(QTY_ERROR).max(MAX_QTY, QTY_ERROR), QTY_ERROR)
const name = z.string({ error: "Заполните наименование" }).trim().min(1, "Заполните наименование").max(255, "Не более 255 символов")
const text = () => z.string().trim().max(2000, "Не более 2000 символов").default("")

/** A picture of a machine or of a defect: empty, a raster data URL (what the forms send: the page
 * shows it in an <img> and links to it), or an http(s) / site path kept from older data. Anything
 * else — a "javascript:" link first of all — is refused: the value becomes an href. */
const image = z
  .string()
  .max(3_000_000, "Изображение слишком большое")
  .refine((value) => value === "" || /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value) || /^(https?:\/\/|\/(?!\/))[^\s"'<>\\]*$/.test(value), "Неверный формат изображения")
  .default("")
const id = dbId()
const optionalId = dbId().nullable().default(null)
/** «Добавление партии» (LIST): the reference's messages for a missing stage and a long comment. */
export const PARTY_STAGE_REQUIRED = "Необходимо выбрать цех"
export const PARTY_COMMENT_MAX = 500
export const PARTY_COMMENT_ERROR = "Убедитесь, что в этом поле не больше 500 символов."

/** "product:12" / "raw_material:5" catalog key, validated and split. */
export const itemKeySchema = z
  .string({ error: "Неверный товар" })
  .transform((value, context) => {
    const parsed = parseItemKey(value)
    if (!parsed) {
      context.addIssue({ code: "custom", message: "Неверный товар" })
      return z.NEVER
    }
    return parsed
  })

export const itemLinesSchema = z.array(z.object({ key: itemKeySchema, amount })).min(1, "Добавьте хотя бы один товар").max(500)

export const schemas = {
  // Склад and Ответственный by id (the dialog), else by name (older clients); the id wins.
  stage: z
    .object({
      name,
      warehouseId: optionalId.optional(),
      warehouse: z.string({ error: "Укажите склад" }).trim().max(255, "Не более 255 символов").default(""),
      responsible: z.string({ error: "Неверное значение" }).trim().max(255, "Не более 255 символов").default(""),
      responsibleId: optionalId.optional(),
    })
    .refine((value) => Boolean(value.warehouseId) || value.warehouse !== "", { message: "Укажите склад", path: ["warehouse"] }),
  // STAFFEQ: a machine of the stage tab (lib/production-staffeq-schemas.ts, with Linko's field messages).
  equipment: equipmentSchema,
  // Operations are global like the reference's (no stage: a stageId sent by older clients is dropped). Their
  // titles may be longer than other names (the reference keeps 256+ characters); an «Оборудование» operation's
  // machine is checked by the repo (lib/production-stages-repo.ts).
  operation: z.object({
    title: z.string({ error: "Заполните наименование" }).trim().min(1, "Заполните наименование").max(2000, "Не более 2000 символов"),
    duration: strictNum(z.number().int().min(0).max(MAX_QTY).default(0)),
    type: z.enum(["equipment", "human"]),
    equipmentId: optionalId,
  }),
  // STAFFEQ: a staff row = an employee on a shift of the Смены directory; an edit changes the shift only.
  staff: staffSchema,
  staffUpdate: staffUpdateSchema,
  // PRODUCTS: a stage product. Its equipment is required, as the reference's (400 «equipment: Это поле
  // обязательно к заполнению»); the product must be a catalog product on no other stage (the repo checks).
  recipe: z.object({
    stageId: id,
    key: itemKeySchema,
    equipmentId: dbId("Укажите оборудование"),
    amount,
    components: z.array(z.object({ role: z.enum(["raw", "ready"]), key: itemKeySchema, amount })).max(500).default([]),
  }),
  // «Изменение нормы»: a stageId other than the current one moves the product there (the reference's «Производство»).
  recipeUpdate: z.object({
    stageId: id.optional(),
    equipmentId: optionalId,
    amount,
  }),
  recipeComponent: z.object({ role: z.enum(["raw", "ready"]), key: itemKeySchema, amount }),
  componentAmount: z.object({ amount }),
  // «Прикрепить операцию»: every chosen operation to every selected stage product.
  productOperations: z.object({
    recipeIds: z.array(id, { error: "Выберите хотя бы один продукт" }).min(1, "Выберите хотя бы один продукт").max(500, "Неверные данные"),
    operationIds: z.array(id, { error: "Выберите хотя бы одну операцию" }).min(1, "Выберите хотя бы одну операцию").max(200, "Неверные данные"),
  }),
  // LIST («Добавление партии»): the reference's own refusals — no stage («Необходимо выбрать цех»), a comment of more
  // than 500 characters. The day is a stock day: never after today (lib/production-stock.ts assertMovementDay).
  party: z.object({
    stageId: dbId(PARTY_STAGE_REQUIRED),
    date: dateString,
    comment: z.string({ error: "Неверные данные" }).trim().max(PARTY_COMMENT_MAX, PARTY_COMMENT_ERROR).default(""),
  }),
  // «Изменение партии»: the comment has the limit of «Добавление партии» (the reference refuses more than 500 characters).
  partyUpdate: z.object({
    stageId: id,
    status: z.enum(["pending", "finished", "cancelled"]),
    date: dateString,
    comment: z.string({ error: "Неверные данные" }).trim().max(PARTY_COMMENT_MAX, PARTY_COMMENT_ERROR).default(""),
  }),
  partyItems: z.object({
    direction: z.enum(["made", "raw"]),
    date: dateString.optional(),
    items: itemLinesSchema,
  }),
  defect: z.object({
    type: z.enum(["made", "raw"]),
    key: itemKeySchema,
    amount,
    comment: text(),
    image,
  }),
  // «Автодобавление»: the stage product and the amount made. Like the reference, the server works the consumed raw
  // materials out from the product's norm; components a client still sends are ignored (dropped by the schema).
  autoFinish: z.object({
    recipeId: id,
    amount,
    comment: text(),
  }),
  // Активность (ACTIVITY): a shift entry. The shift is one of the Смены directory, by id (shiftId) or by
  // its name (shift); the activity repo refuses any other (400).
  activity: z.object({
    stageId: id,
    direction: z.enum(["made", "raw"]),
    date: dateString,
    shiftId: optionalId,
    shift: z.string().trim().max(100).default(""),
    equipmentId: optionalId,
    worker: z.string().trim().max(255).default(""),
    items: z.array(z.object({ key: itemKeySchema, amount, isDefect: z.boolean().default(false) })).min(1, "Добавьте хотя бы один товар").max(500),
  }),
  // «Изменить» of a shift entry in «Записи»: its new amount.
  activityAmount: z.object({ amount }),
  // «Сверить» is the warehouse's inventory (Склад → Инвентаризация, /api/stock/inventories) now; the stage's
  // own earlier reconciliations are read only (GET /api/production/inventories).
}

/** Shared response for the batch movement endpoints (add made / raw / defect,
 * auto-finish), which all return the refreshed batch detail. */
export function movementResponse(result: object | "not_found" | "not_pending" | "empty") {
  if (result === "not_found") return notFound("Партия не найдена")
  if (result === "not_pending") return errorResponse("Партия уже завершена", 409)
  if (result === "empty") return errorResponse("Добавьте хотя бы один товар")
  return NextResponse.json(result)
}

/** A query day: a real "YYYY-MM-DD" of a sane year (2000..2100, lib/document-dates.ts), as the body schemas take it. */
export function isDateParam(value: string | null): value is string {
  return !!value && isIsoDay(value) && docYearOk(value)
}

/** 400 «Неверная дата» (with the field) for the first named query day that is given but is no valid day
 * (isDateParam: malformed, or a year outside 2000..2100); null when each is missing or valid. A route then keeps
 * its «… обязательны» answer for the values that are really missing. */
export function dateParamError(params: URLSearchParams, ...names: string[]): NextResponse | null {
  for (const name of names) {
    const value = params.get(name)
    if (value !== null && value !== "" && !isDateParam(value)) return errorResponse(DATE_ERROR, 400, { field: name })
  }
  return null
}
