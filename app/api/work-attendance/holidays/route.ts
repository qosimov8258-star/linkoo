import { NextRequest, NextResponse } from "next/server"

import { holidaysSchema, parseYearMonth, YEAR_MONTH_INVALID } from "@/lib/attendance-api"
import { attendanceErrorResponse } from "@/lib/attendance-errors"
import { getHolidays, replaceHolidays } from "@/lib/attendance-weekend-days-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

// Holiday days of a month (Добавить выходные дни), month 1..12, dates "YYYY-MM-DD".
// GET ?year&month → {year, month, dates, configured}; POST {year, month, dates} replaces the
// month's set (manager + settings.manage) and re-derives the month's days.

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const period = parseYearMonth(request.nextUrl.searchParams)
  if (!period) return NextResponse.json({ error: YEAR_MONTH_INVALID, field: "month" }, { status: 400 })
  try {
    return NextResponse.json(await getHolidays(period.year, period.month))
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, holidaysSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await replaceHolidays({ ...parsed.data, actor: auth.user.displayName }))
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}
