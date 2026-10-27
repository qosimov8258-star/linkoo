import "server-only"

import { NextResponse } from "next/server"
import { z, type ZodError, type ZodType } from "zod"

export type ParsedBody<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse }

// Russian i18n keys of the common API refusals. Every API error is a Russian
// dictionary key, so the views translate it with t() (never hard-code Uzbek or
// English texts in a route).
/** 401: no session, or a revoked one (same text as the middleware's). */
export const NOT_SIGNED_IN_MESSAGE = "Вы не вошли в систему"
/** 400: a request that fails validation without a more precise reason. */
export const INVALID_DATA_MESSAGE = "Неверные данные"
/** 404: the requested record does not exist. */
export const NOT_FOUND_MESSAGE = "Не найдено"
/** 400: the body is not JSON. */
export const NOT_JSON_MESSAGE = "Тело запроса не является JSON"
/** Russian i18n key of a refused text value (NUL or broken Unicode). */
export const BAD_TEXT_MESSAGE = "Текст содержит недопустимые символы"

/** 401 of a route whose user is not signed in (the session is missing or was
 * revoked); the same body as the middleware answers. */
export function notSignedInResponse() {
  return NextResponse.json({ error: NOT_SIGNED_IN_MESSAGE, code: "notSignedIn" }, { status: 401 })
}

/** Russian i18n key of a technical field hint ("YYYY-MM-DD", "required", "cash | bank"). */
function hintMessage(hint: string): string {
  if (/YYYY-MM-DD/.test(hint)) return "Неверная дата"
  if (hint === "required") return "Обязательное поле"
  return INVALID_DATA_MESSAGE
}

/** 400 for one bad query / body field. `hint` is a technical hint kept in
 * `details` ("YYYY-MM-DD", "cash | bank"); `error` is a Russian i18n key. */
export function invalidFieldResponse(field: string, hint: string, message = hintMessage(hint)) {
  return NextResponse.json({ error: message, field, details: { formErrors: [], fieldErrors: { [field]: [hint] } } }, { status: 400 })
}

// --- Zod messages ------------------------------------------------------------
// Schemas name their refusals with Russian i18n keys ("Неверная дата"). Where a
// schema sets none, zod's English default ("Invalid input: expected string,
// received undefined") would reach the user; it is mapped here, by issue code,
// to a Russian key instead: globally (z.config below, every server-side parse)
// and again when an error is answered (zodErrorBody).

const CYRILLIC = /[А-Яа-яЁё]/

type IssueLike = {
  code?: string
  message?: string
  expected?: unknown
  origin?: unknown
  format?: unknown
  minimum?: unknown
  inclusive?: boolean
  input?: unknown
}

/** Russian i18n key for a zod issue by its code (used when the schema gave no Russian message). */
export function zodIssueKey(issue: IssueLike): string {
  const message = issue.message ?? ""
  if (/YYYY-MM-DD/.test(message)) return "Неверная дата"
  // A raw issue (error map) carries the input; a finished one only zod's English text.
  const missing = "input" in issue ? issue.input === undefined || issue.input === null : /received (undefined|null)\b/.test(message)
  switch (issue.code) {
    case "invalid_type":
      if (missing) return "Обязательное поле"
      if (issue.expected === "int") return "Введите целое число"
      if (issue.expected === "number" || issue.expected === "bigint") return "Введите число"
      if (issue.expected === "date") return "Неверная дата"
      return "Неверное значение"
    case "too_big":
      if (issue.origin === "string") return "Слишком длинное значение"
      if (issue.origin === "array" || issue.origin === "set") return "Слишком много значений"
      if (issue.origin === "date") return "Неверная дата"
      return "Слишком большое значение"
    case "too_small": {
      const minimum = Number(issue.minimum)
      if (issue.origin === "string") return minimum <= 1 ? "Обязательное поле" : "Слишком короткое значение"
      if (issue.origin === "array" || issue.origin === "set") return "Добавьте хотя бы одну строку"
      if (issue.origin === "date") return "Неверная дата"
      if (minimum === 0) return issue.inclusive === false ? "Введите положительное число" : "Значение не может быть отрицательным"
      return "Слишком маленькое значение"
    }
    case "invalid_format":
      return /date|time/i.test(String(issue.format ?? "")) ? "Неверная дата" : "Неверный формат"
    case "unrecognized_keys":
      return INVALID_DATA_MESSAGE
    default:
      return "Неверное значение"
  }
}

/** The issue's own message when it is a Russian i18n key, else the key for its code. */
export function zodIssueMessage(issue: IssueLike): string {
  return issue.message && CYRILLIC.test(issue.message) ? issue.message : zodIssueKey(issue)
}

// Every server-side parse: zod's English defaults become Russian i18n keys.
// Messages set by a schema still win (schema-level errors take precedence).
z.config({ customError: (issue) => zodIssueKey(issue as IssueLike) })

/** The 400 body of a failed zod parse: the first issue's message (a Russian i18n
 * key) as `error` and its path as `field`, plus every field's messages in
 * `details` (zod's flatten shape), so a form can show the reason under its field. */
export function zodErrorBody(error: ZodError) {
  const first = error.issues[0]
  return {
    error: first ? zodIssueMessage(first) : INVALID_DATA_MESSAGE,
    field: first?.path.map(String).join(".") || null,
    details: z.flattenError(error, (issue) => zodIssueMessage(issue)),
  }
}

/** 400 answer of a failed zod parse (see zodErrorBody). */
export function zodErrorResponse(error: ZodError) {
  return NextResponse.json(zodErrorBody(error), { status: 400 })
}

// Invisible format characters dropped from every text value: soft hyphen,
// combining grapheme joiner, Arabic letter mark, Hangul / Khmer / Mongolian
// fillers, zero-width space / non-joiner / joiner, LRM / RLM, bidi embeddings,
// overrides and isolates, word joiner / invisible operators, BOM. Without them
// a name could be blank, or look like another record's name.
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]/g
// NUL is refused by Postgres ("invalid byte sequence"), and a lone UTF-16
// surrogate is silently stored as "�". Both answer 400 instead.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
// Passwords are only hashed (never stored as text) and compared byte for byte,
// so they are neither checked nor rewritten.
const SECRET_KEY = /password/i
const MAX_DEPTH = 64

class TextIssue {
  constructor(
    readonly field: string,
    readonly message = BAD_TEXT_MESSAGE,
  ) {}
}

function checkText(text: string, field: string) {
  if (text.includes("\u0000") || LONE_SURROGATE.test(text)) throw new TextIssue(field)
}

// Names are single-line: a run of whitespace holding a control character (TAB,
// LF, CR, U+2028/2029, …) becomes one space, so a pasted "A\tB\nC" is stored as
// "A B C" (never a raw tab / line break that splits list cells and CSV rows).
// Linear on purpose: each maximal whitespace / control run is matched once and
// only then tested for a control character. A pattern that brackets the control
// character with two optional runs backtracks quadratically on a long run of
// plain spaces, and this runs on unauthenticated bodies before any rate limit.
const NAME_KEY = /^name$|Name$/
const SPACE_RUN = /[\s\p{Cc}]+/gu
const CONTROL_CHAR = /[\p{Cc}\u2028\u2029]/u

/** One text value: invisible format characters dropped, NFC-normalised (an
 * "é" typed as e + combining acute equals the precomposed one, so look-alike
 * twins cannot pass a uniqueness check), and, for a name, control characters
 * folded into a space. */
function cleanString(value: string, key: string): string {
  const text = value.replace(INVISIBLE, "").normalize("NFC")
  return NAME_KEY.test(key) ? text.replace(SPACE_RUN, (run) => (CONTROL_CHAR.test(run) ? " " : run)) : text
}

function cleanValue(value: unknown, key: string, field: string, depth: number): unknown {
  if (typeof value === "string") {
    if (SECRET_KEY.test(key)) return value
    checkText(value, field)
    return cleanString(value, key)
  }
  if (value === null || typeof value !== "object") return value
  if (depth > MAX_DEPTH) throw new TextIssue(field, INVALID_DATA_MESSAGE)
  if (Array.isArray(value)) return value.map((item, index) => cleanValue(item, key, field ? `${field}.${index}` : String(index), depth + 1))
  const out: Record<string, unknown> = {}
  for (const [name, item] of Object.entries(value)) {
    const path = field ? `${field}.${name}` : name
    checkText(name, path)
    // "__proto__" stays an own key, exactly as JSON.parse produced it.
    Object.defineProperty(out, name, { value: cleanValue(item, name, path, depth + 1), enumerable: true, writable: true, configurable: true })
  }
  return out
}

/** Cleans every string of a parsed JSON body: drops invisible format characters
 * (so a zero-width-only name is empty and fails `.min(1)`), NFC-normalises it,
 * folds control characters of names (`name`, `*Name`) into one space, and refuses
 * NUL and lone surrogates. Returns the cleaned value, or the refused field's path
 * and message. */
export function cleanJsonText(value: unknown): { value: unknown; issue?: undefined } | { value?: undefined; issue: { field: string; message: string } } {
  try {
    return { value: cleanValue(value, "", "", 0) }
  } catch (error) {
    if (error instanceof TextIssue) return { issue: { field: error.field, message: error.message } }
    throw error
  }
}

/** Reads and validates a request's JSON body against a Zod schema. Use at
 * the top of every route handler that accepts a body:
 *   const parsed = await parseJsonBody(request, mySchema)
 *   if (parsed.error) return parsed.error
 *   const input = parsed.data
 * Every string is cleaned first (cleanJsonText). A refusal answers 400 with
 * the first field's reason as `error` (a Russian i18n key, zodErrorBody).
 */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<ParsedBody<T>> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return { error: NextResponse.json({ error: NOT_JSON_MESSAGE }, { status: 400 }) }
  }
  const cleaned = cleanJsonText(json)
  if (cleaned.issue) {
    return { error: NextResponse.json({ error: cleaned.issue.message, field: cleaned.issue.field || null }, { status: 400 }) }
  }
  const result = schema.safeParse(cleaned.value, { error: (issue) => zodIssueKey(issue as IssueLike) })
  if (!result.success) return { error: zodErrorResponse(result.error) }
  return { data: result.data }
}

/** Largest id of an INTEGER (int4) column. */
export const MAX_ROUTE_ID = 2_147_483_647

/** A route segment → positive int4 id, or null for anything else ("abc", "1.5",
 * "1e3", "-1", "0", "%00", values beyond int4), so it never reaches Postgres. */
export function parseIdSegment(value: string | null | undefined): number | null {
  const text = String(value ?? "")
  if (!/^\d+$/.test(text)) return null
  const id = Number(text)
  return id > 0 && id <= MAX_ROUTE_ID ? id : null
}

/** 400 answer for a route id that is not a positive integer. */
export function invalidIdResponse() {
  return NextResponse.json({ error: "Неверный идентификатор" }, { status: 400 })
}
