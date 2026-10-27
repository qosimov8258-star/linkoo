import "server-only"

import { NextResponse } from "next/server"
import { z, type ZodType } from "zod"

import { cleanJsonText, NOT_JSON_MESSAGE, zodErrorBody, zodIssueMessage } from "@/lib/validation"

// Request parsing for the platform routes (auth, users, access rights,
// employees, branches, currencies, positions):
//  * the body is read with a hard byte cap, so the size limit holds for the
//    bytes actually received, chunked uploads included (the middleware only
//    sees the Content-Length header);
//  * a schema failure answers 400 with the first field's own message
//    (Russian i18n key) instead of a bare "Неверные данные".

export const MAX_JSON_BYTES = 256 * 1024

export type Parsed<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse }

function bad(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!request.body) return ""
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** The first issue's reason as a Russian i18n key (zod's English defaults mapped by code). */
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0]
  return issue ? zodIssueMessage(issue) : "Неверные данные"
}

export async function parseBody<T>(request: Request, schema: ZodType<T>, maxBytes = MAX_JSON_BYTES): Promise<Parsed<T>> {
  const text = await readCapped(request, maxBytes)
  if (text === null) return { error: bad("Слишком большой запрос", 413) }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { error: bad(NOT_JSON_MESSAGE) }
  }
  // Zero-width / bidi characters are dropped from every text (passwords excepted);
  // NUL and broken Unicode answer 400.
  const cleaned = cleanJsonText(json)
  if (cleaned.issue) return { error: bad(cleaned.issue.message, 400, { field: cleaned.issue.field || null }) }
  const result = schema.safeParse(cleaned.value)
  if (!result.success) {
    const body = zodErrorBody(result.error)
    return { error: bad(body.error, 400, { field: body.field, details: body.details }) }
  }
  return { data: result.data }
}

/** Positive integer id from a route segment, or null (→ 404 by the caller). */
export function parseId(raw: string): number | null {
  if (!/^\d{1,9}$/.test(raw)) return null
  const id = Number(raw)
  return id > 0 ? id : null
}

/** Trims, collapses whitespace, drops invisible format characters and turns
 * control characters (TAB, LF, …) into spaces ("A\tB" → "A B", never "AB"). */
export function cleanText(value: string): string {
  return value.normalize("NFC").replace(/\p{Cf}/gu, "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim()
}

/** A required, cleaned name of at most `max` characters; `required` is the
 * message (Russian i18n key) for a missing or empty value. */
export function nameField(required: string, max = 200) {
  return z
    .string({ error: required })
    .transform(cleanText)
    .pipe(z.string().min(1, { error: required }).max(max, { error: "Слишком длинное значение" }))
}

/** An optional cleaned text of at most `max` characters. */
export function textField(max = 200) {
  return z
    .string({ error: "Неверные данные" })
    .transform(cleanText)
    .pipe(z.string().max(max, { error: "Слишком длинное значение" }))
}

/** Postgres unique violation (23505). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505"
}
