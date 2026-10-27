import { NextResponse, type NextRequest } from "next/server"

import { requireFieldReader, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { lastLocations } from "@/lib/field-activity/gps-repo"
import { badQuery, fieldRoute } from "@/lib/field-activity/http"
import { dayParam, dayStartMs, idsParam } from "@/lib/field-activity/input"
import { todayIso } from "@/lib/finance/dates"

const DAY_MS = 24 * 60 * 60_000

// GET /api/field-activity/locations — live location of employees: ?employeeId (comma list; empty =
// every employee the reader may see) &date (a past day: the last point of that day).
// → {date, rows: LastLocation[]}.
export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const params = request.nextUrl.searchParams
  const ids = idsParam(params, "employeeId")
  if (!ids.ok) return badQuery(ids)
  const day = dayParam(params.get("date"), "date")
  if (!day.ok) return badQuery(day)
  const until = day.value < todayIso() ? dayStartMs(day.value) + DAY_MS : Date.now()
  return fieldRoute(async () =>
    NextResponse.json({ date: day.value, rows: await lastLocations(scopedEmployeeIds(reader.scope, ids.value.length ? ids.value : undefined), until) }),
  )
}
