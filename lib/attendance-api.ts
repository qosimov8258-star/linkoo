import "server-only"

import { z } from "zod"

import { EDITABLE_TYPES, isClockTime, monthDays, type EditableType } from "@/lib/attendance-types"
import { DOC_MAX_YEAR, DOC_MIN_YEAR, parseDocDay } from "@/lib/document-dates"
import { dbId, strictId } from "@/lib/strict-number"

// Request schemas and query parsers of /api/work-attendance/** (Посещаемость).
// Months are 1..12 here (the demo's staff/attendance API); the older
// /api/attendance-weekend-days keeps its 0..11. Messages are Russian i18n keys.

export const YEAR_MONTH_INVALID = "Неверный год или месяц"
const TIME_INVALID = "Укажите время в формате ЧЧ:ММ"

const year = z.number({ error: YEAR_MONTH_INVALID }).int(YEAR_MONTH_INVALID).min(DOC_MIN_YEAR, YEAR_MONTH_INVALID).max(DOC_MAX_YEAR, YEAR_MONTH_INVALID)
const month = z.number({ error: YEAR_MONTH_INVALID }).int(YEAR_MONTH_INVALID).min(1, YEAR_MONTH_INVALID).max(12, YEAR_MONTH_INVALID)

/** A query value of digits only → number; anything else ("1e3", "0x10", "1.5", "") → NaN. */
function digits(value: string | null, max = 4): number {
  const text = String(value ?? "").trim()
  return new RegExp(`^\\d{1,${max}}$`).test(text) ? Number(text) : Number.NaN
}

/** ?year=YYYY&month=M (1..12), or null. */
export function parseYearMonth(params: URLSearchParams): { year: number; month: number } | null {
  const y = year.safeParse(digits(params.get("year")))
  const m = month.safeParse(digits(params.get("month"), 2))
  return y.success && m.success ? { year: y.data, month: m.data } : null
}

/** ?branch=1,2 → ids, or null when any is not a positive id (or more than 50). */
export function parseBranchIds(value: string | null): number[] | null {
  const text = String(value ?? "").trim()
  if (!text) return []
  const parts = text.split(",")
  if (parts.length > 50) return null
  const ids = parts.map((part) => strictId(part.trim()))
  return ids.every((id): id is number => id !== null) ? [...new Set(ids)] : null
}

export const MAX_SEARCH = 100

/** A day "YYYY-MM-DD" under the document date rules (year 2000..2100; not after today unless allowFuture). */
export function parseDay(value: string | null | undefined, allowFuture: boolean): { ok: true; date: string } | { ok: false; error: string } {
  const text = String(value ?? "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, error: "Неверная дата" }
  return parseDocDay(text, { allowFuture })
}

export const yearMonthSchema = z.object({ year, month })

export const holidaysSchema = z
  .object({
    year,
    month,
    dates: z.array(z.string({ error: "Неверная дата" }).trim().max(10, "Неверная дата"), { error: "Неверные данные" }).max(31, "Слишком много значений"),
  })
  .superRefine((value, ctx) => {
    const valid = new Set(monthDays(value.year, value.month))
    value.dates.forEach((date, index) => {
      if (!valid.has(date)) ctx.addIssue({ code: "custom", message: "Дата вне выбранного месяца", path: ["dates", index] })
    })
  })

export const workTimeSchema = z.object({
  late: z.string({ error: TIME_INVALID }).trim().refine((value) => isClockTime(value), TIME_INVALID),
})

export const setDaysSchema = z
  .object({
    employeeIds: z
      .array(dbId("Сотрудник не найден"), { error: "Хотя бы выберете одного агента !" })
      .min(1, "Хотя бы выберете одного агента !")
      .max(1000, "Слишком много значений"),
    date: z.string({ error: "Укажите дату" }).trim().min(1, "Укажите дату").max(10, "Неверная дата"),
    type: z.enum(EDITABLE_TYPES as unknown as [EditableType, ...EditableType[]], { error: "Выберите тип посещения" }),
    time: z
      .string({ error: TIME_INVALID })
      .trim()
      .refine((value) => !value || isClockTime(value), TIME_INVALID)
      .nullable()
      .optional(),
    comment: z.string({ error: "Неверное значение" }).trim().max(500, "Не более 500 символов").optional(),
  })
  .transform((value, ctx) => {
    const day = parseDay(value.date, false)
    if (!day.ok) {
      ctx.addIssue({ code: "custom", message: day.error, path: ["date"] })
      return z.NEVER
    }
    return { ...value, date: day.date, time: value.time || null, comment: value.comment ?? "" }
  })

const cell = z.union([z.string().max(200, "Слишком длинное значение"), z.number(), z.null()], { error: "Неверное значение" }).transform((value) =>
  value === null ? "" : String(value),
)

export const importSchema = z.object({
  year,
  month,
  rows: z
    .array(z.array(cell, { error: "Неверные данные" }).max(100, "Слишком много значений"), { error: "Неверные данные" })
    .min(1, "Файл пустой")
    .max(5001, "Слишком много строк"),
})
