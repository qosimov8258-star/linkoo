import { NextRequest, NextResponse } from "next/server"

import { parseDay } from "@/lib/attendance-api"
import { attendanceErrorResponse } from "@/lib/attendance-errors"
import { dayDetail } from "@/lib/attendance-repo"
import { getCurrentUser } from "@/lib/current-user"
import { strictId } from "@/lib/strict-number"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/work-attendance/day?employeeId=10&date=2026-10-22 — the agent-day drawer: the
// effective day, its check-ins and the orders the employee took that day (per currency).
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const params = request.nextUrl.searchParams
  const employeeId = strictId(params.get("employeeId"))
  if (!employeeId) return NextResponse.json({ error: "Неверный идентификатор", field: "employeeId" }, { status: 400 })
  const day = parseDay(params.get("date"), true)
  if (!day.ok) return NextResponse.json({ error: day.error, field: "date" }, { status: 400 })
  try {
    return NextResponse.json(await dayDetail(employeeId, day.date))
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}
