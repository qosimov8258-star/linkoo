import { NextRequest, NextResponse } from "next/server"

import { MAX_SEARCH, parseBranchIds, parseYearMonth, YEAR_MONTH_INVALID } from "@/lib/attendance-api"
import { attendanceErrorResponse } from "@/lib/attendance-errors"
import { listAttendance } from "@/lib/attendance-repo"
import { getCurrentUser } from "@/lib/current-user"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/work-attendance?year=2026&month=10[&search=…][&branch=1,2] — the Посещаемость
// matrix of a month: holidays, work time, active employees and their effective days.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const params = request.nextUrl.searchParams
  const period = parseYearMonth(params)
  if (!period) return NextResponse.json({ error: YEAR_MONTH_INVALID, field: "month" }, { status: 400 })
  const search = (params.get("search") ?? "").trim()
  if (search.length > MAX_SEARCH) return NextResponse.json({ error: "Слишком длинное значение", field: "search" }, { status: 400 })
  const branchIds = parseBranchIds(params.get("branch"))
  if (!branchIds) return NextResponse.json({ error: "Филиал не найден", field: "branch" }, { status: 400 })
  try {
    return NextResponse.json(await listAttendance({ ...period, search, branchIds }))
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}
