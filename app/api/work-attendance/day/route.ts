import { NextRequest, NextResponse } from "next/server"

import { parseDay } from "@/lib/attendance-api"
import { attendanceErrorResponse } from "@/lib/attendance-errors"
import { dayDetail } from "@/lib/attendance-repo"
import { requireFieldReader, scopeAllows } from "@/lib/field-activity/actor"
import { strictId } from "@/lib/strict-number"

const EMPLOYEE_NOT_FOUND = "Сотрудник не найден"

// GET /api/work-attendance/day?employeeId=10&date=2026-10-22 — the agent-day drawer: the
// effective day, its check-ins and the orders the employee took that day (per currency). An
// employee outside the reader's field scope (lib/field-activity/actor.ts) answers 404 like an
// unknown one; a user without any field scope gets 403.
export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const params = request.nextUrl.searchParams
  const employeeId = strictId(params.get("employeeId"))
  if (!employeeId) return NextResponse.json({ error: "Неверный идентификатор", field: "employeeId" }, { status: 400 })
  const day = parseDay(params.get("date"), true)
  if (!day.ok) return NextResponse.json({ error: day.error, field: "date" }, { status: 400 })
  if (!scopeAllows(reader.scope, employeeId)) return NextResponse.json({ error: EMPLOYEE_NOT_FOUND, field: "employeeId" }, { status: 404 })
  try {
    return NextResponse.json(await dayDetail(employeeId, day.date))
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}
