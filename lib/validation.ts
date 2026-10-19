import "server-only"

import { NextResponse } from "next/server"
import type { ZodType } from "zod"

export type ParsedBody<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse }

/** Reads and validates a request's JSON body against a Zod schema. Use at
 * the top of every route handler that accepts a body:
 *   const parsed = await parseJsonBody(request, mySchema)
 *   if (parsed.error) return parsed.error
 *   const input = parsed.data
 */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<ParsedBody<T>> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return { error: NextResponse.json({ error: "Тело запроса не является JSON" }, { status: 400 }) }
  }
  const result = schema.safeParse(json)
  if (!result.success) {
    return { error: NextResponse.json({ error: "Неверные данные", details: result.error.flatten() }, { status: 400 }) }
  }
  return { data: result.data }
}
