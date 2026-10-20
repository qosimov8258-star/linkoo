import "server-only"

import { NextResponse } from "next/server"
import { z, type ZodType } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { isIsoDay } from "@/lib/finance/dates"
import { isProductionError, parseItemKey } from "@/lib/production-schema"
import { cleanJsonText, parseIdSegment, type ParsedBody } from "@/lib/validation"

export type RouteParams = { params: Promise<{ id: string }> }

/** Route id → positive int4 (canonical digits only), else null (→ 404, never a 500). */
export async function routeId({ params }: RouteParams): Promise<number | null> {
  return parseIdSegment((await params).id)
}

export async function requireViewer() {
  const user = await getCurrentUser()
  return user ? null : NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
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
    return { error: errorResponse("Тело запроса не является JSON") }
  }
  // Zero-width / bidi characters are dropped from every text; NUL and broken Unicode answer 400.
  const cleaned = cleanJsonText(json)
  if (cleaned.issue) return { error: errorResponse(cleaned.issue.message, 400, { field: cleaned.issue.field || null }) }
  const result = schema.safeParse(cleaned.value)
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).find((text) => /[А-Яа-яЁё]/.test(text))
    return { error: errorResponse(message ?? "Неверные данные", 400, { details: z.flattenError(result.error) }) }
  }
  return { data: result.data }
}

/** Upper bound of every quantity (contract: 0 < qty ≤ 1e9). */
export const MAX_QTY = 1e9

const DATE_ERROR = "Неверная дата"
/** A real calendar day "YYYY-MM-DD" (2026-13-45 and 2026-02-31 are refused). */
const dateString = z.string({ error: DATE_ERROR }).regex(/^\d{4}-\d{2}-\d{2}$/, DATE_ERROR).refine((value) => isIsoDay(value), DATE_ERROR)
const QTY_ERROR = "Количество должно быть больше 0 и не больше 1 000 000 000"
const amount = z.coerce.number({ error: QTY_ERROR }).finite(QTY_ERROR).positive(QTY_ERROR).max(MAX_QTY, QTY_ERROR)
const name = z.string({ error: "Заполните наименование" }).trim().min(1, "Заполните наименование").max(255, "Не более 255 символов")
const text = () => z.string().trim().max(2000, "Не более 2000 символов").default("")
const TIME_ERROR = "Время должно быть в формате ЧЧ:ММ"
const time = z.string().trim().refine((value) => value === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value), TIME_ERROR).default("")
const id = z.coerce.number().int().positive()
const optionalId = z.coerce.number().int().positive().nullable().default(null)

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
  stage: z.object({
    name,
    warehouse: z.string({ error: "Укажите склад" }).trim().min(1, "Укажите склад").max(255),
    responsible: z.string().trim().max(255).default(""),
    responsibleId: optionalId.optional(),
  }),
  equipment: z.object({
    stageId: id,
    name,
    status: z.enum(["0", "1"]).default("0"),
    image: z.string().max(3_000_000).default(""),
  }),
  operation: z.object({
    stageId: id,
    title: name,
    duration: z.coerce.number().int().min(0).max(MAX_QTY).default(0),
    type: z.enum(["equipment", "human"]),
    equipmentId: optionalId,
  }),
  staff: z.object({
    stageId: id,
    employeeId: optionalId,
    employeeName: z.string().trim().max(255).default(""),
    position: z.string().trim().max(255).default(""),
    shift: z.string().trim().max(100).default(""),
    beginTime: time,
    endTime: time,
  }),
  recipe: z.object({
    stageId: id,
    key: itemKeySchema,
    equipmentId: optionalId,
    amount,
    components: z.array(z.object({ role: z.enum(["raw", "ready"]), key: itemKeySchema, amount })).max(500).default([]),
  }),
  recipeUpdate: z.object({
    equipmentId: optionalId,
    amount,
  }),
  recipeComponent: z.object({ role: z.enum(["raw", "ready"]), key: itemKeySchema, amount }),
  componentAmount: z.object({ amount }),
  party: z.object({
    stageId: id,
    date: dateString,
    comment: text(),
  }),
  partyUpdate: z.object({
    stageId: id,
    status: z.enum(["pending", "finished", "cancelled"]),
    date: dateString,
    comment: text(),
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
    image: z.string().max(3_000_000).default(""),
  }),
  autoFinish: z.object({
    recipeId: id,
    amount,
    comment: text(),
    components: z.array(z.object({ key: itemKeySchema, amount })).max(500).default([]),
  }),
  activity: z.object({
    stageId: id,
    direction: z.enum(["made", "raw"]),
    date: dateString,
    shift: z.string().trim().max(100).default(""),
    equipmentId: optionalId,
    worker: z.string().trim().max(255).default(""),
    items: z.array(z.object({ key: itemKeySchema, amount, isDefect: z.boolean().default(false) })).min(1, "Добавьте хотя бы один товар").max(500),
  }),
  inventory: z.object({
    stageId: id,
    date: dateString,
    comment: text(),
    lines: z
      .array(
        z.object({
          key: itemKeySchema,
          actual: z.coerce.number({ error: "Фактическое количество: от 0 до 1 000 000 000" }).finite().min(0, "Фактическое количество: от 0 до 1 000 000 000").max(MAX_QTY, "Фактическое количество: от 0 до 1 000 000 000"),
        }),
      )
      .min(1, "Нет строк для сверки")
      .max(5000),
  }),
}

/** Shared response for the batch movement endpoints (add made / raw / defect,
 * auto-finish), which all return the refreshed batch detail. */
export function movementResponse(result: object | "not_found" | "not_pending" | "empty") {
  if (result === "not_found") return notFound("Партия не найдена")
  if (result === "not_pending") return errorResponse("Партия уже завершена", 409)
  if (result === "empty") return errorResponse("Добавьте хотя бы один товар")
  return NextResponse.json(result)
}

export function isDateParam(value: string | null): value is string {
  return !!value && isIsoDay(value)
}
