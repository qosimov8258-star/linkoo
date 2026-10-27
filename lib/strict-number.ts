import { z } from "zod"

// Strict number input of request bodies and query strings. z.coerce.number()
// and Number(text) guess: true → 1, [5] → 5, "0x10" → 16, "0b11" → 3, so a
// front-end bug or a tampered request silently linked a record to id 1 or
// stored 1 / 5 / 16 as an amount. These helpers accept only a JSON number or a
// plain decimal text ("12", "-3.5", " 7 ", ".5", "1e3"); booleans, arrays,
// objects and any other text ("0x10", "Infinity", "12abc") are refused.
// Shared by the server schemas and the client forms (no server-only import).

/** Largest id of an INTEGER (int4) column. */
export const MAX_DB_ID = 2_147_483_647
/** Russian i18n keys of the refusals. */
export const NOT_A_NUMBER = "Должно быть числом"
export const INVALID_ID = "Неверный идентификатор"

/**
 * A plain decimal number text: sign, digits with an optional point fraction, optional exponent.
 * Unambiguous on purpose (fraction digits only after a point), so a failed match is linear:
 * with "\d+\.?\d*" both \d+ and \d* could take the same digits, and 40 000 digits + "x"
 * blocked the server for seconds (catastrophic backtracking).
 */
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
/** Longest number text read at all (a double has 17 significant digits; "1 000 000 000 000,00" is 20 chars). */
export const MAX_NUMBER_TEXT = 100

/**
 * A number or a plain decimal text → number; anything else (booleans, arrays,
 * objects, null, "", "0x10", "Infinity", "12abc") → NaN.
 * `locale`: also accepts a decimal comma and spaces between digit groups ("1 000,5"),
 * as the stock and money forms type them.
 */
export function strictNumber(value: unknown, options: { locale?: boolean } = {}): number {
  if (typeof value === "number") return value
  if (typeof value !== "string") return Number.NaN
  let text = value.trim()
  if (text.length > MAX_NUMBER_TEXT) return Number.NaN
  if (options.locale) text = text.replace(/[\s  ]/g, "").replace(",", ".")
  return DECIMAL_TEXT.test(text) ? Number(text) : Number.NaN
}

/** Zod: a plain decimal number text → number (use as z.union([z.number(), decimalText()])). */
export const decimalText = (message: string = NOT_A_NUMBER) =>
  z
    .string()
    .trim()
    .refine((text) => text.length <= MAX_NUMBER_TEXT && DECIMAL_TEXT.test(text), message)
    .transform(Number)

/** A positive int4 id given as a number or a digit text, else null. */
export function strictId(value: unknown): number | null {
  const id = typeof value === "number" ? value : typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : Number.NaN
  return Number.isInteger(id) && id > 0 && id <= MAX_DB_ID ? id : null
}

/**
 * Zod: a positive int4 id given as a JSON number or a digit text ("42") → number.
 * Booleans, arrays, null, "", "0x10", "1e3", 0, 1.5 and ids beyond int4 fail with
 * `message` (a Russian i18n key), so they never link a record to id 1 / 16 or reach
 * Postgres as an out-of-range integer. Chain .optional() / .nullable() outside.
 * `allowZero`: 0 is accepted too (fields where 0 means "none", e.g. a contract's agentId).
 */
export function dbId(message: string = INVALID_ID, options: { allowZero?: boolean } = {}) {
  const min = options.allowZero ? 0 : 1
  return z.preprocess(
    (value, ctx) => {
      if (value === undefined || typeof value === "number") return value
      if (typeof value === "string" && /^\s*\d+\s*$/.test(value)) return Number(value)
      ctx.issues.push({ code: "custom", message, input: value })
      return z.NEVER
    },
    // One check, so an out-of-range id reports one message (not "int" + "max").
    z.number({ error: message }).refine((id) => Number.isInteger(id) && id >= min && id <= MAX_DB_ID, message),
  )
}

/**
 * Strict replacement of z.coerce.number(): wraps a z.number() chain, e.g.
 *   strictNum(z.number().finite().positive().max(MAX_MONEY))
 * The chain sees numbers and plain decimal texts as numbers; booleans, arrays,
 * objects and other texts fail with `message`. Blank text and null keep the old
 * z.coerce meaning (0), unless the chain accepts null itself (.nullable());
 * undefined reaches the chain unchanged (.optional() / .default()).
 */
export function strictNum<T extends z.ZodType>(schema: T, message: string = NOT_A_NUMBER) {
  const acceptsNull = schema.safeParse(null).success
  return z.preprocess((value, ctx) => {
    if (value === undefined || typeof value === "number") return value
    if (value === null) return acceptsNull ? null : 0
    if (typeof value === "string" && !value.trim()) return 0
    const number = strictNumber(value)
    if (Number.isNaN(number)) {
      ctx.issues.push({ code: "custom", message, input: value })
      return z.NEVER
    }
    return number
  }, schema)
}
