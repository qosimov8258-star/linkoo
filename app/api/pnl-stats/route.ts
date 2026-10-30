import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { dbErrorResponse } from "@/lib/db-errors"
import { parseDocDay } from "@/lib/document-dates"
import { getPnlOptions, getPnlStats } from "@/lib/pnl-stats-repo"

/** Longest list a filter takes (branches, zones, agents …) and the longest value in it. */
const MAX_FILTER_VALUES = 500
const MAX_FILTER_TEXT = 300

const fail = (error: string, field?: string) => NextResponse.json({ error, ...(field ? { field } : {}) }, { status: 400 })

/** "a|b|c" → ["a", "b", "c"]; null when the list is longer than a filter takes. */
function list(params: URLSearchParams, key: string): string[] | null {
  const values = (params.get(key) ?? "").split("|").filter(Boolean)
  return values.length > MAX_FILTER_VALUES || values.some((value) => value.length > MAX_FILTER_TEXT) ? null : values
}

// GET /api/pnl-stats?first_begin&first_end&second_begin&second_end[&branches=a|b…] — the dashboard "P&L" tab
// (two periods compared); ?options=1 → the filter lists. Every bound is a business day (lib/document-dates.ts:
// a real date, year 2000–2100; a period may reach into the future), begin ≤ end; wrong input → 400 JSON.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const params = request.nextUrl.searchParams
  try {
    if (params.get("options")) return NextResponse.json(await getPnlOptions())

    const bounds: Record<string, string> = {}
    for (const key of ["first_begin", "first_end", "second_begin", "second_end"]) {
      const raw = params.get(key)?.trim() ?? ""
      if (!raw) return fail("Требуются first_begin, first_end, second_begin и second_end", key)
      const day = parseDocDay(raw, { allowFuture: true })
      if (!day.ok) return fail(day.error, key)
      bounds[key] = day.date
    }
    for (const prefix of ["first", "second"]) {
      if (bounds[`${prefix}_begin`] > bounds[`${prefix}_end`]) return fail("Дата начала позже даты окончания", `${prefix}_begin`)
    }

    const filters = {
      branches: list(params, "branches"),
      zones: list(params, "zones"),
      agents: list(params, "agents"),
      productTypes: list(params, "productTypes"),
      products: list(params, "products"),
    }
    const tooLong = Object.entries(filters).find(([, values]) => values === null)
    if (tooLong) return fail("Слишком много значений", tooLong[0])

    return NextResponse.json(
      await getPnlStats(
        { begin: bounds.first_begin, end: bounds.first_end },
        { begin: bounds.second_begin, end: bounds.second_end },
        {
          branches: filters.branches ?? [],
          zones: filters.zones ?? [],
          agents: filters.agents ?? [],
          productTypes: filters.productTypes ?? [],
          products: filters.products ?? [],
        },
      ),
    )
  } catch (error) {
    const response = dbErrorResponse(error)
    if (response) return response
    throw error
  }
}
