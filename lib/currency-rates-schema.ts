import { z } from "zod"

import { DOC_DATE_INVALID, parseDocDay } from "@/lib/document-dates"
import { MAX_NUMBER_TEXT } from "@/lib/strict-number"

// Rates typed in the "Валюты" dialogs (Добавить валюту, Изменить валюту, Установить курс,
// Индивидуальный курс). Strict (as lib/strict-number.ts): a JSON number, or a plain decimal
// text with an optional decimal comma and spaces between digit groups ("12 070,85").
// Booleans, arrays, "", "0x10", "1e3", "Infinity", "12abc", signs and 0 are refused;
// the value is kept with at most RATE_DECIMALS decimals. Messages are Russian i18n keys.

const REQUIRED = "Обязательное поле"
export const RATE_REQUIRED = "Укажите курс валюты"
export const RATE_POSITIVE = "Курс должен быть положительным числом"
export const RATE_TOO_BIG = "Курс слишком большой"
/** Largest rate (units of the base currency per 1 unit). */
export const RATE_MAX = 1_000_000_000
/** Decimals kept: 1 SUM against a USD base is 0.0000790514 USD. */
export const RATE_DECIMALS = 10

/** Unsigned decimal text, no exponent: one point at most, digits on at least one side.
 * Unambiguous (fraction digits only after the point), so a failed match is linear. */
const RATE_TEXT = /^(?:\d+(?:\.\d*)?|\.\d+)$/

export type RateParse = { ok: true; rate: number } | { ok: false; error: string; missing: boolean }

/** A typed rate → a number in (0, RATE_MAX] with at most RATE_DECIMALS decimals, or the error key.
 * `missing` marks an absent / blank value (the caller decides whether that is allowed). */
export function parseRate(value: unknown): RateParse {
  let rate: number
  if (value === undefined || value === null) return { ok: false, error: RATE_REQUIRED, missing: true }
  if (typeof value === "number") {
    rate = value
  } else if (typeof value === "string") {
    if (value.length > MAX_NUMBER_TEXT) return { ok: false, error: RATE_POSITIVE, missing: false }
    const text = value.replace(/[\s  ]/g, "").replace(",", ".")
    if (!text) return { ok: false, error: RATE_REQUIRED, missing: true }
    if (!RATE_TEXT.test(text)) return { ok: false, error: RATE_POSITIVE, missing: false }
    rate = Number(text)
  } else {
    return { ok: false, error: RATE_POSITIVE, missing: false }
  }
  if (!Number.isFinite(rate) || rate <= 0) return { ok: false, error: RATE_POSITIVE, missing: false }
  if (rate > RATE_MAX) return { ok: false, error: RATE_TOO_BIG, missing: false }
  const kept = Number(rate.toFixed(RATE_DECIMALS))
  if (!(kept > 0)) return { ok: false, error: RATE_POSITIVE, missing: false }
  return { ok: true, rate: kept }
}

/** Zod: a required rate (parseRate). */
export const rateValue = z.unknown().transform((value, ctx) => {
  const parsed = parseRate(value)
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.error })
    return z.NEVER
  }
  return parsed.rate
})

/** Zod: an optional rate: absent (undefined / null) → undefined; "" and anything else as rateValue. */
export const optionalRateValue = z
  .unknown()
  .transform((value, ctx): number | undefined => {
    if (value === undefined || value === null) return undefined
    const parsed = parseRate(value)
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.error })
      return z.NEVER
    }
    return parsed.rate
  })
  .optional()

/** A validity day of an individual rate: required, any date form lib/document-dates.ts reads,
 * year 2000–2100, future allowed → "YYYY-MM-DD". */
const day = z.unknown().transform((value, ctx): string => {
  if (typeof value !== "string" || !value.trim()) {
    ctx.addIssue({ code: "custom", message: value === undefined || value === null || typeof value === "string" ? "Укажите дату" : DOC_DATE_INVALID })
    return z.NEVER
  }
  const parsed = parseDocDay(value, { allowFuture: true })
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.error })
    return z.NEVER
  }
  return parsed.date
})

export const setRateSchema = z.object({ rate: rateValue })

export const individualRateSchema = z
  .object({
    name: z.string({ error: REQUIRED }).trim().min(1, REQUIRED).max(255, "Слишком длинное значение"),
    rate: rateValue,
    beginDate: day,
    endDate: day,
  })
  .refine((value) => value.endDate >= value.beginDate, { path: ["endDate"], message: "Дата завершения раньше даты начала" })
