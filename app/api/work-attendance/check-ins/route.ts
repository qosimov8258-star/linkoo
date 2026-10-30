import { NextRequest, NextResponse } from "next/server"

import { parseDay } from "@/lib/attendance-api"
import { attendanceErrorResponse } from "@/lib/attendance-errors"
import { managerCheckInSchema } from "@/lib/check-ins-schema"
import { listCheckIns, recordCheckIn } from "@/lib/check-ins-repo"
import { requireFieldReader, scopeAllows } from "@/lib/field-activity/actor"
import { requireRole } from "@/lib/rbac"
import { strictId } from "@/lib/strict-number"
import { parseJsonBody } from "@/lib/validation"

// Check-ins of an employee registered from the web (a manager, an office terminal):
// GET ?employeeId&date → the day's events; POST {employeeId, kind, at?, lat?, lng?, accuracy?,
// place?, comment?, idempotencyKey?} (manager + settings.manage). The mobile app uses
// /api/mobile/check-ins for the signed-in employee himself. GET follows the reader's field scope
// (lib/field-activity/actor.ts): an employee outside it answers 404 like an unknown one.

const EMPLOYEE_NOT_FOUND = "Сотрудник не найден"

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
    return NextResponse.json(await listCheckIns(employeeId, day.date))
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, managerCheckInSchema)
  if (parsed.error) return parsed.error
  try {
    const result = await recordCheckIn({
      ...parsed.data,
      userId: auth.user.id,
      source: "web",
      actor: auth.user.displayName,
    })
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 })
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}
