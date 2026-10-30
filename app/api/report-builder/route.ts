import { NextResponse } from "next/server"
import { z } from "zod"

import { parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { parseDocDay } from "@/lib/document-dates"
import { requireFieldReader, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { FIELD_MESSAGES, fieldErrorResponse } from "@/lib/field-activity/errors"
import { builderFilterOptions, runBuilderReport, type BuilderInput, type BuilderKind } from "@/lib/report-builder-repo"

// Refusals are Russian i18n keys; a FieldError of the visits source (period checks of
// lib/agent-visits-repo.ts) and a busy database answer as JSON (fieldErrorResponse), never 500.
// The visits report (Конструктор) is field data: it follows the field scope of
// lib/field-activity/actor.ts like Активность / Отслеживание — an agent gets only their own visits
// (and their supervised agents'), and a user without any field scope gets 403.
const NOT_SIGNED_IN = "Вы не вошли в систему"
const UNKNOWN_KIND = "Неизвестный тип отчета"
const BAD_DATA = "Неверные данные"
/** Longest column / grouping list, filter count and text the page sends. */
const MAX_NAMES = 200
const MAX_FILTERS = 100
const MAX_TEXT = 300

const fail = (error: string, field?: string) => NextResponse.json({ error, ...(field ? { field } : {}) }, { status: 400 })

const isKind = (value: unknown): value is BuilderKind => value === "sales" || value === "visits"

/** A list of names (columns, groupings): missing → []; anything but short strings → null. */
function names(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_NAMES) return null
  return value.every((item) => typeof item === "string" && item.length <= MAX_TEXT) ? (value as string[]) : null
}

/** The {label: value} filters: missing → {}; empty values are dropped; anything else than short strings → null. */
function filterMap(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return {}
  if (typeof value !== "object" || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_FILTERS) return null
  const filters: Record<string, string> = {}
  for (const [key, item] of entries) {
    if (item === undefined || item === null || item === "") continue
    if (typeof item !== "string" || key.length > MAX_TEXT || item.length > MAX_TEXT) return null
    filters[key] = item
  }
  return filters
}

// POST /api/report-builder {kind: "sales" | "visits", tab, from, to, columns[], vertical[], horizontal[], filters{}, showTotals}
// → {headers, rows, totals, unsupported, count[, currency, missingRates]}; GET ?kind=… → filter option lists.
export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: NOT_SIGNED_IN }, { status: 401 })
  // Capped JSON read (413 above 256 KB), invisible / broken characters handled as everywhere.
  const parsed = await parseBody(request, z.unknown())
  if (parsed.error) return parsed.error
  const body = parsed.data
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(BAD_DATA)
  const data = body as Record<string, unknown>
  if (!isKind(data.kind)) return fail(UNKNOWN_KIND, "kind")
  let employeeIds: number[] | undefined
  if (data.kind === "visits") {
    const reader = await requireFieldReader()
    if (reader.error) return reader.error
    employeeIds = scopedEmployeeIds(reader.scope, undefined)
  }

  // The period: business days (lib/document-dates.ts: a real date, year 2000–2100), from ≤ to.
  if (typeof data.from !== "string" || !data.from.trim() || typeof data.to !== "string" || !data.to.trim()) {
    return fail("Укажите период", typeof data.from === "string" && data.from.trim() ? "to" : "from")
  }
  const from = parseDocDay(data.from, { allowFuture: true })
  if (!from.ok) return fail(from.error, "from")
  const to = parseDocDay(data.to, { allowFuture: true })
  if (!to.ok) return fail(to.error, "to")
  if (from.date > to.date) return fail(FIELD_MESSAGES.badRange, "from")

  const columns = names(data.columns)
  const vertical = names(data.vertical)
  const horizontal = names(data.horizontal)
  if (!columns) return fail(BAD_DATA, "columns")
  if (!vertical) return fail(BAD_DATA, "vertical")
  if (!horizontal) return fail(BAD_DATA, "horizontal")
  if (!columns.length) return fail("Выберите хотя бы одну колонку", "columns")
  const filters = filterMap(data.filters)
  if (!filters) return fail(BAD_DATA, "filters")
  if (data.tab !== undefined && data.tab !== null && (typeof data.tab !== "string" || data.tab.length > MAX_TEXT)) return fail(BAD_DATA, "tab")
  if (data.showTotals !== undefined && typeof data.showTotals !== "boolean") return fail(BAD_DATA, "showTotals")

  const input: BuilderInput = {
    kind: data.kind,
    tab: typeof data.tab === "string" ? data.tab : "",
    from: from.date,
    to: to.date,
    columns,
    vertical,
    horizontal,
    filters,
    showTotals: data.showTotals !== false,
    employeeIds,
  }
  try {
    return NextResponse.json(await runBuilderReport(input))
  } catch (error) {
    const response = fieldErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: NOT_SIGNED_IN }, { status: 401 })
  const kind = new URL(request.url).searchParams.get("kind")
  if (!isKind(kind)) return fail(UNKNOWN_KIND, "kind")
  let employeeIds: number[] | undefined
  if (kind === "visits") {
    const reader = await requireFieldReader()
    if (reader.error) return reader.error
    employeeIds = scopedEmployeeIds(reader.scope, undefined)
  }
  try {
    return NextResponse.json(await builderFilterOptions(kind, employeeIds))
  } catch (error) {
    const response = fieldErrorResponse(error)
    if (response) return response
    throw error
  }
}
