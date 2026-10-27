import "server-only"

import { NextResponse } from "next/server"
import type { ZodType } from "zod"

export type ParsedBody<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse }

/** Russian i18n key of a refused text value (NUL or broken Unicode). */
export const BAD_TEXT_MESSAGE = "Текст содержит недопустимые символы"

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

function cleanValue(value: unknown, key: string, field: string, depth: number): unknown {
  if (typeof value === "string") {
    if (SECRET_KEY.test(key)) return value
    checkText(value, field)
    return value.replace(INVISIBLE, "")
  }
  if (value === null || typeof value !== "object") return value
  if (depth > MAX_DEPTH) throw new TextIssue(field, "Неверные данные")
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
 * (so a zero-width-only name is empty and fails `.min(1)`), and refuses NUL and
 * lone surrogates. Returns the cleaned value, or the refused field's path and message. */
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
 * Every string is cleaned first (cleanJsonText).
 */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<ParsedBody<T>> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return { error: NextResponse.json({ error: "Тело запроса не является JSON" }, { status: 400 }) }
  }
  const cleaned = cleanJsonText(json)
  if (cleaned.issue) {
    return { error: NextResponse.json({ error: cleaned.issue.message, field: cleaned.issue.field || null }, { status: 400 }) }
  }
  const result = schema.safeParse(cleaned.value)
  if (!result.success) {
    return { error: NextResponse.json({ error: "Неверные данные", details: result.error.flatten() }, { status: 400 }) }
  }
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
