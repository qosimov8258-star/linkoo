import { NextResponse, type NextRequest } from "next/server"

import { requireFieldReader, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { badQuery, fieldRoute } from "@/lib/field-activity/http"
import { dayParam, idsParam } from "@/lib/field-activity/input"
import { dayStatus } from "@/lib/field-activity/routes-repo"

// GET /api/field-activity/day-status — plan vs. visits of employees on a local day:
// ?employeeId (comma list; empty = every employee with a plan or a visit that day) &date
// (default today). → {date, rows: DayStatus[]} (planned clients in route order, visited client
// ids, done / todo / unplanned).
export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const params = request.nextUrl.searchParams
  const ids = idsParam(params, "employeeId")
  if (!ids.ok) return badQuery(ids)
  const day = dayParam(params.get("date"), "date")
  if (!day.ok) return badQuery(day)
  return fieldRoute(async () =>
    NextResponse.json({ date: day.value, rows: await dayStatus(scopedEmployeeIds(reader.scope, ids.value.length ? ids.value : undefined), day.value) }),
  )
}
