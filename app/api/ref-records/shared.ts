import "server-only"

import { NextResponse } from "next/server"

import { requiredPermission } from "@/lib/capabilities-catalog"
import { getCurrentUser } from "@/lib/current-user"
import { requirePermission } from "@/lib/rbac"
import { apiAllows, apiKind, apiMaxBytes, type RefApiMethod, type RefKind } from "@/lib/ref-records-repo"
import { INVALID_DATA_MESSAGE, NOT_JSON_MESSAGE, cleanJsonText, notSignedInResponse } from "@/lib/validation"

// Shared checks of the /api/ref-records writers (not a route: App Router only serves route.ts files).

type Refusal = { error: NextResponse }

/**
 * The caller may change records of `rawKind` with `method`: a kind the generic API serves (404), a method that kind's page
 * uses (405), and the permission lib/capabilities-catalog.ts maps /api/ref-records/<kind> to — checked explicitly here
 * (requirePermission), so it holds even where the request path header is missing; a kind without a mapping is refused.
 */
export async function refRecordsWriter(rawKind: string, method: RefApiMethod): Promise<{ kind: RefKind } | Refusal> {
  if (!(await getCurrentUser())) return { error: notSignedInResponse() }
  const kind = apiKind(rawKind)
  if (!kind) return { error: NextResponse.json({ error: "Неизвестный раздел" }, { status: 404 }) }
  const code = requiredPermission(`/api/ref-records/${kind}`, method)
  if (!apiAllows(kind, method) || !code) {
    return { error: NextResponse.json({ error: "Действие недоступно" }, { status: 405, headers: { Allow: allowed(kind).join(", ") } }) }
  }
  const auth = await requirePermission(code)
  if ("error" in auth) return auth
  return { kind }
}

function allowed(kind: RefKind): string[] {
  return ["GET", ...(["POST", "PUT", "DELETE"] as const).filter((method) => apiAllows(kind, method))]
}

/** The JSON object body of a write: at most the kind's record size (413), JSON (400), a plain object (400), text cleaned
 * (NUL / broken Unicode refused, invisible characters dropped, NFC). */
export async function refRecordsBody(request: Request, kind: RefKind): Promise<{ data: Record<string, unknown> } | Refusal> {
  const text = await request.text()
  if (Buffer.byteLength(text, "utf8") > apiMaxBytes(kind)) return { error: NextResponse.json({ error: "Слишком большой запрос" }, { status: 413 }) }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { error: NextResponse.json({ error: NOT_JSON_MESSAGE }, { status: 400 }) }
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return { error: NextResponse.json({ error: INVALID_DATA_MESSAGE }, { status: 400 }) }
  const cleaned = cleanJsonText(json)
  if (cleaned.issue) return { error: NextResponse.json({ error: cleaned.issue.message, field: cleaned.issue.field || null }, { status: 400 }) }
  return { data: cleaned.value as Record<string, unknown> }
}
