import { NextResponse, type NextRequest } from "next/server"

import { requireFieldReader, scopeAllows } from "@/lib/field-activity/actor"
import { gpsTrack } from "@/lib/field-activity/gps-repo"
import { badQuery, fieldRoute, idParam } from "@/lib/field-activity/http"
import { dayParam, timeParam } from "@/lib/field-activity/input"

// GET /api/field-activity/gps — an employee's GPS track of a local day in time order:
// ?employeeId (required unless the reader may see only their own data) &date (default today)
// &from=HH:mm &to=HH:mm (time window of that day, both inclusive). → {employeeId, date, points}.
export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const params = request.nextUrl.searchParams
  const employee = idParam(params.get("employeeId"), "employeeId", reader.scope.all)
  if (!employee.ok) return badQuery(employee)
  const employeeId = employee.value ?? (reader.scope.all ? 0 : reader.scope.employeeId)
  const day = dayParam(params.get("date"), "date")
  if (!day.ok) return badQuery(day)
  const from = timeParam(params.get("from"), "from")
  if (!from.ok) return badQuery(from)
  const to = timeParam(params.get("to"), "to")
  if (!to.ok) return badQuery(to)
  if (!scopeAllows(reader.scope, employeeId)) return NextResponse.json({ employeeId, date: day.value, points: [] })
  return fieldRoute(async () =>
    NextResponse.json({ employeeId, date: day.value, points: await gpsTrack(employeeId, day.value, { fromMinute: from.value, toMinute: to.value }) }),
  )
}
