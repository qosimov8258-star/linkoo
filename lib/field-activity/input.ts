import "server-only"

import { z } from "zod"

import { DOC_MAX_YEAR, DOC_MIN_YEAR } from "@/lib/document-dates"
import { isIsoDay, todayIso } from "@/lib/finance/dates"
import { dbId, MAX_DB_ID, strictNumber } from "@/lib/strict-number"
import { FIELD_MESSAGES } from "@/lib/field-activity/errors"
import { MAX_CLOCK_SKEW_MS, MAX_COMMENT, MAX_DATA_AGE_DAYS, MAX_GPS_BATCH, MAX_REFUSAL_PHOTOS, MAX_REPORT_PHOTOS, VISIT_RESULTS } from "@/lib/field-activity/types"

// Input rules of the field activity API: device times, coordinates and the mobile request
// bodies. Messages are Russian i18n keys.

/** Asia/Tashkent has no DST: UTC+5 all year. */
export const TZ_OFFSET_MS = 5 * 60 * 60_000
const DAY_MS = 24 * 60 * 60_000
const INVALID_DATE = "Неверная дата"
const TOO_LONG_COMMENT = "Не более 1000 символов"

const pad = (value: number, size = 2) => String(value).padStart(size, "0")

/** Local (Asia/Tashkent) "YYYY-MM-DDTHH:mm:ss" of an instant. */
export function localIso(ms: number): string {
  const d = new Date(ms + TZ_OFFSET_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

/** Local day "YYYY-MM-DD" of an instant. */
export function localDay(ms: number): string {
  return localIso(ms).slice(0, 10)
}

/** Instant (ms) of local midnight of `day` ("YYYY-MM-DD"). */
export function dayStartMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number)
  return Date.UTC(y, m - 1, d) - TZ_OFFSET_MS
}

/** ISO weekday (1 = Monday .. 7 = Sunday) of a local day. */
export function isoWeekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return weekday === 0 ? 7 : weekday
}

/** `day` moved by `days` ("YYYY-MM-DD"). */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number)
  const next = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS)
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`
}

// ISO date-time sent by a device: "2026-10-26T10:15:00Z", "…T10:15:00.123+05:00", "…T10:15"
// (no zone: Tashkent local). Linear on purpose (no nested quantifiers on user input).
const DEVICE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i

export type DeviceTime = { ok: true; ms: number } | { ok: false; error: string }

/**
 * A device time (ISO text or epoch milliseconds) → instant, under the field rules: a real
 * calendar time, year within 2000..2100, at most MAX_CLOCK_SKEW_MS in the future and at most
 * MAX_DATA_AGE_DAYS old.
 */
export function parseDeviceTime(value: unknown, now = Date.now()): DeviceTime {
  let ms: number
  if (value === undefined || value === null || value === "") return { ok: false, error: "Обязательное поле" }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return { ok: false, error: INVALID_DATE }
    ms = value
  } else if (typeof value === "string") {
    const text = value.trim()
    const match = text.length <= 40 ? DEVICE_TIME.exec(text) : null
    if (!match) return { ok: false, error: INVALID_DATE }
    const [, y, mo, d, h, mi, s, frac, zone] = match
    const parts = [Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0)]
    const local = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5])
    const check = new Date(local)
    if (
      check.getUTCFullYear() !== parts[0] ||
      check.getUTCMonth() !== parts[1] - 1 ||
      check.getUTCDate() !== parts[2] ||
      parts[3] > 23 ||
      parts[4] > 59 ||
      parts[5] > 59
    ) {
      return { ok: false, error: INVALID_DATE }
    }
    let offsetMs = TZ_OFFSET_MS
    if (zone) {
      if (zone.toUpperCase() === "Z") offsetMs = 0
      else {
        const digits = zone.slice(1).replace(":", "")
        const hours = Number(digits.slice(0, 2))
        const minutes = Number(digits.slice(2, 4) || 0)
        if (minutes > 59 || hours * 60 + minutes > 14 * 60) return { ok: false, error: INVALID_DATE }
        offsetMs = (zone.startsWith("-") ? -1 : 1) * (hours * 60 + minutes) * 60_000
      }
    }
    ms = local - offsetMs + (frac ? Math.floor(Number(`0.${frac}`) * 1000) : 0)
  } else {
    return { ok: false, error: INVALID_DATE }
  }
  if (!Number.isFinite(ms)) return { ok: false, error: INVALID_DATE }
  const year = Number(localIso(ms).slice(0, 4))
  if (!(year >= DOC_MIN_YEAR && year <= DOC_MAX_YEAR)) return { ok: false, error: INVALID_DATE }
  if (ms > now + MAX_CLOCK_SKEW_MS) return { ok: false, error: FIELD_MESSAGES.futureTime }
  if (ms < now - MAX_DATA_AGE_DAYS * DAY_MS) return { ok: false, error: FIELD_MESSAGES.tooOld }
  return { ok: true, ms }
}

/** Zod: a device time → epoch ms (see parseDeviceTime). */
export function deviceTime() {
  return z.unknown().transform((value, ctx) => {
    const parsed = parseDeviceTime(value)
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.error })
      return z.NEVER
    }
    return parsed.ms
  })
}

/** Zod: an optional strict number (JSON number or plain decimal text) within [min, max]. */
function boundedNumber(min: number, max: number, message: string) {
  return z.preprocess(
    (value, ctx) => {
      if (value === undefined || value === null) return value
      const number = strictNumber(value)
      if (!Number.isFinite(number)) {
        ctx.issues.push({ code: "custom", message, input: value })
        return z.NEVER
      }
      return number
    },
    z.number({ error: message }).min(min, message).max(max, message).nullable().optional(),
  )
}

const latitude = () => boundedNumber(-90, 90, FIELD_MESSAGES.badCoordinates)
const longitude = () => boundedNumber(-180, 180, FIELD_MESSAGES.badCoordinates)
const accuracy = () => boundedNumber(0, 100_000, "Неверная точность")
const comment = () => z.string({ error: "Неверное значение" }).trim().max(MAX_COMMENT, TOO_LONG_COMMENT).optional()

/** Idempotency key of a device request (a UUID or similar). */
const key = () =>
  z
    .string({ error: FIELD_MESSAGES.badKey })
    .trim()
    .min(8, FIELD_MESSAGES.badKey)
    .max(64, FIELD_MESSAGES.badKey)
    .regex(/^[A-Za-z0-9._:-]+$/, FIELD_MESSAGES.badKey)

type Position = { lat?: number | null; lng?: number | null }

/** Both coordinates or neither, and never the (0, 0) "null island" of a failed fix. */
function checkPosition(value: Position, ctx: z.RefinementCtx, prefix = "") {
  const hasLat = value.lat !== undefined && value.lat !== null
  const hasLng = value.lng !== undefined && value.lng !== null
  if (hasLat !== hasLng) ctx.addIssue({ code: "custom", message: FIELD_MESSAGES.coordinatesPair, path: [`${prefix}${hasLat ? "lng" : "lat"}`] })
  else if (hasLat && value.lat === 0 && value.lng === 0) ctx.addIssue({ code: "custom", message: FIELD_MESSAGES.badCoordinates, path: [`${prefix}lat`] })
}

const photoIds = (max: number) => z.array(dbId(FIELD_MESSAGES.photoNotFound), { error: "Неверное значение" }).max(max, "Слишком много фото").optional()

export const visitStartSchema = z
  .object({
    key: key(),
    clientId: dbId(FIELD_MESSAGES.clientNotFound),
    startedAt: deviceTime(),
    lat: latitude(),
    lng: longitude(),
    accuracy: accuracy(),
    comment: comment(),
  })
  .superRefine((value, ctx) => checkPosition(value, ctx))

export type VisitStartInput = z.infer<typeof visitStartSchema>

export const visitFinishSchema = z
  .object({
    key: key().optional(),
    visitId: dbId(FIELD_MESSAGES.visitNotFound).optional(),
    finishedAt: deviceTime(),
    lat: latitude(),
    lng: longitude(),
    accuracy: accuracy(),
    result: z.enum(VISIT_RESULTS, { error: "Неверный результат визита" }),
    orderId: dbId(FIELD_MESSAGES.orderNotFound).nullable().optional(),
    comment: comment(),
    refusal: z
      .object({
        refusalTypeId: dbId(FIELD_MESSAGES.refusalTypeNotFound).nullable().optional(),
        comment: comment(),
        photoIds: photoIds(MAX_REFUSAL_PHOTOS),
      })
      .nullable()
      .optional(),
    report: z
      .object({
        comment: comment(),
        beforePhotoIds: photoIds(MAX_REPORT_PHOTOS),
        afterPhotoIds: photoIds(MAX_REPORT_PHOTOS),
      })
      .nullable()
      .optional(),
  })
  .superRefine((value, ctx) => {
    checkPosition(value, ctx)
    if (value.key === undefined && value.visitId === undefined) ctx.addIssue({ code: "custom", message: FIELD_MESSAGES.visitNotFound, path: ["key"] })
    if (value.result === "refusal") {
      if (!value.refusal) ctx.addIssue({ code: "custom", message: FIELD_MESSAGES.refusalRequired, path: ["refusal"] })
      else if (!value.refusal.refusalTypeId && !value.refusal.comment) {
        ctx.addIssue({ code: "custom", message: FIELD_MESSAGES.refusalReasonRequired, path: ["refusal", "refusalTypeId"] })
      }
    } else if (value.refusal) {
      // A refusal belongs to a visit whose result is the refusal.
      ctx.addIssue({ code: "custom", message: "Неверный результат визита", path: ["result"] })
    }
    if (value.result === "photo_report" && !value.report) ctx.addIssue({ code: "custom", message: FIELD_MESSAGES.reportRequired, path: ["report"] })
    if (value.report && !(value.report.beforePhotoIds?.length || value.report.afterPhotoIds?.length)) {
      ctx.addIssue({ code: "custom", message: FIELD_MESSAGES.reportPhotosRequired, path: ["report", "beforePhotoIds"] })
    }
    if (value.orderId && value.result !== "order") ctx.addIssue({ code: "custom", message: "Неверный результат визита", path: ["result"] })
  })

export type VisitFinishInput = z.infer<typeof visitFinishSchema>

const gpsPointSchema = z.object({
  recordedAt: deviceTime(),
  lat: latitude().refine((value) => value !== undefined && value !== null, FIELD_MESSAGES.badCoordinates),
  lng: longitude().refine((value) => value !== undefined && value !== null, FIELD_MESSAGES.badCoordinates),
  accuracy: accuracy(),
  speed: boundedNumber(0, 200, "Неверная скорость"),
  battery: boundedNumber(0, 100, "Неверный уровень заряда"),
}).superRefine((value, ctx) => checkPosition(value, ctx))

export const gpsBatchSchema = z.object({
  points: z
    .array(gpsPointSchema, { error: "Неверное значение" })
    .min(1, "Добавьте хотя бы одну точку")
    .max(MAX_GPS_BATCH, "Не более 1000 точек"),
})

export type GpsBatchInput = z.infer<typeof gpsBatchSchema>

const isoWeekdays = z
  .array(z.number({ error: "Неверный день недели" }).int("Неверный день недели").min(1, "Неверный день недели").max(7, "Неверный день недели"), {
    error: FIELD_MESSAGES.weekdaysRequired,
  })
  .min(1, FIELD_MESSAGES.weekdaysRequired)
  .max(7, "Неверный день недели")

const clientIds = z
  .array(dbId(FIELD_MESSAGES.clientNotFound), { error: "Неверное значение" })
  .min(1, "Выберите клиентов")
  .max(500, "Не более 500 клиентов")

/** PUT /api/field-activity/route-plans: the employee visits these clients on these weekdays. */
export const routePlanSchema = z.object({
  employeeId: dbId(FIELD_MESSAGES.employeeNotFound),
  clientIds,
  weekdays: isoWeekdays,
  intervalWeeks: z.number({ error: "Неверная периодичность" }).int("Неверная периодичность").min(1, "Неверная периодичность").max(4, "Неверная периодичность").optional(),
  startDate: z
    .string({ error: INVALID_DATE })
    .trim()
    .refine((value) => isIsoDay(value) && Number(value.slice(0, 4)) >= DOC_MIN_YEAR && Number(value.slice(0, 4)) <= DOC_MAX_YEAR, INVALID_DATE)
    .optional(),
})

export type RoutePlanInput = z.infer<typeof routePlanSchema>

/** DELETE /api/field-activity/route-plans and PUT …/order: the employee and the clients (ordered). */
export const routeClientsSchema = z.object({
  employeeId: dbId(FIELD_MESSAGES.employeeNotFound),
  clientIds,
})

export type RouteClientsInput = z.infer<typeof routeClientsSchema>

// --- Query strings of the read APIs ---------------------------------------------------

export type QueryResult<T> = { ok: true; value: T } | { ok: false; field: string; error: string }

/** A local day "YYYY-MM-DD" (year 2000..2100); `fallback` when empty. */
export function dayParam(value: string | null, field: string, fallback = todayIso()): QueryResult<string> {
  const text = (value ?? "").trim()
  if (!text) return { ok: true, value: fallback }
  const year = Number(text.slice(0, 4))
  if (!isIsoDay(text) || year < DOC_MIN_YEAR || year > DOC_MAX_YEAR) return { ok: false, field, error: INVALID_DATE }
  return { ok: true, value: text }
}

/** A period of local days (from ≤ to, at most 366 days). */
export function periodParams(params: URLSearchParams, fromName = "from", toName = "to"): QueryResult<{ from: string; to: string }> {
  const today = todayIso()
  const to = dayParam(params.get(toName), toName, today)
  if (!to.ok) return to
  const from = dayParam(params.get(fromName), fromName, to.value)
  if (!from.ok) return from
  if (from.value > to.value) return { ok: false, field: fromName, error: FIELD_MESSAGES.badRange }
  if (dayStartMs(to.value) - dayStartMs(from.value) > 366 * DAY_MS) return { ok: false, field: fromName, error: FIELD_MESSAGES.rangeTooLong }
  return { ok: true, value: { from: from.value, to: to.value } }
}

/** "1,2,3" (or repeated parameters) → distinct positive int4 ids, at most `max`; empty → []. */
export function idsParam(params: URLSearchParams, name: string, max = 500): QueryResult<number[]> {
  const raw = params.getAll(name).flatMap((value) => value.split(","))
  const ids = new Set<number>()
  for (const part of raw) {
    const text = part.trim()
    if (!text) continue
    const id = /^\d{1,10}$/.test(text) ? Number(text) : Number.NaN
    if (!Number.isInteger(id) || id <= 0 || id > MAX_DB_ID) return { ok: false, field: name, error: "Неверный идентификатор" }
    ids.add(id)
  }
  if (ids.size > max) return { ok: false, field: name, error: "Слишком много значений" }
  return { ok: true, value: [...ids] }
}

/** "HH:mm" → minutes since midnight; empty → null. */
export function timeParam(value: string | null, field: string): QueryResult<number | null> {
  const text = (value ?? "").trim()
  if (!text) return { ok: true, value: null }
  const match = /^(\d{1,2}):(\d{2})$/.exec(text)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return { ok: false, field, error: FIELD_MESSAGES.badTime }
  return { ok: true, value: Number(match[1]) * 60 + Number(match[2]) }
}

/** Positive page number / page size within bounds. */
export function pageParams(params: URLSearchParams, maxSize: number, defaultSize = 25): QueryResult<{ page: number; pageSize: number }> {
  const page = (params.get("page") ?? "1").trim() || "1"
  const size = (params.get("pageSize") ?? String(defaultSize)).trim() || String(defaultSize)
  if (!/^\d{1,6}$/.test(page) || Number(page) < 1) return { ok: false, field: "page", error: "Неверное значение" }
  if (!/^\d{1,4}$/.test(size) || Number(size) < 1 || Number(size) > maxSize) return { ok: false, field: "pageSize", error: "Неверное значение" }
  return { ok: true, value: { page: Number(page), pageSize: Number(size) } }
}

/** "true" / "false" / "yes" / "no" → boolean; empty → undefined. */
export function boolParam(value: string | null, field: string): QueryResult<boolean | undefined> {
  const text = (value ?? "").trim().toLowerCase()
  if (!text) return { ok: true, value: undefined }
  if (text === "true" || text === "yes" || text === "1") return { ok: true, value: true }
  if (text === "false" || text === "no" || text === "0") return { ok: true, value: false }
  return { ok: false, field, error: "Неверное значение" }
}

const EARTH_RADIUS_M = 6_371_000

/** Great-circle distance in metres. */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}
