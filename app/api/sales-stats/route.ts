import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { dbErrorResponse } from "@/lib/db-errors"
import { parseDocDay } from "@/lib/document-dates"
import { fieldScopeOf, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { getSalesOptions, getSalesStats } from "@/lib/sales-stats-repo"

/** Longest list a filter takes (zones, agents …) and the longest value in it. */
const MAX_FILTER_VALUES = 500
const MAX_FILTER_TEXT = 300

const fail = (error: string, field?: string) => NextResponse.json({ error, ...(field ? { field } : {}) }, { status: 400 })

/** "a|b|c" → ["a", "b", "c"]; null when the list is longer than a filter takes. */
function list(params: URLSearchParams, key: string): string[] | null {
  const values = (params.get(key) ?? "").split("|").filter(Boolean)
  return values.length > MAX_FILTER_VALUES || values.some((value) => value.length > MAX_FILTER_TEXT) ? null : values
}

// GET /api/sales-stats?begin=YYYY-MM-DD&end=YYYY-MM-DD[&zones=a|b…] — the dashboard "ПРОДАЖА" tab;
// ?options=1 → the filter lists. begin / end are business days (lib/document-dates.ts: a real date,
// year 2000–2100; a period may reach into the future), begin ≤ end; wrong input → 400 JSON.
// The "Отказ" line counts field refusals, which follow the field scope (lib/field-activity/actor.ts):
// an agent counts only their own (and their supervised agents'), a user without any field scope none.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const params = request.nextUrl.searchParams
  try {
    if (params.get("options")) return NextResponse.json(await getSalesOptions())

    const rawBegin = params.get("begin")?.trim() ?? ""
    const rawEnd = params.get("end")?.trim() ?? ""
    if (!rawBegin || !rawEnd) return fail("Укажите период", rawBegin ? "end" : "begin")
    const begin = parseDocDay(rawBegin, { allowFuture: true })
    if (!begin.ok) return fail(begin.error, "begin")
    const end = parseDocDay(rawEnd, { allowFuture: true })
    if (!end.ok) return fail(end.error, "end")
    if (begin.date > end.date) return fail("Дата начала позже даты окончания", "begin")

    const filters = {
      zones: list(params, "zones"),
      marketTypes: list(params, "marketTypes"),
      productTypes: list(params, "productTypes"),
      agents: list(params, "agents"),
      brands: list(params, "brands"),
    }
    const tooLong = Object.entries(filters).find(([, values]) => values === null)
    if (tooLong) return fail("Слишком много значений", tooLong[0])

    const scope = await fieldScopeOf(user)
    return NextResponse.json(
      await getSalesStats(begin.date, end.date, {
        zones: filters.zones ?? [],
        marketTypes: filters.marketTypes ?? [],
        productTypes: filters.productTypes ?? [],
        agents: filters.agents ?? [],
        brands: filters.brands ?? [],
        fieldEmployeeIds: scope ? scopedEmployeeIds(scope, undefined) : [],
      }),
    )
  } catch (error) {
    const response = dbErrorResponse(error)
    if (response) return response
    throw error
  }
}
