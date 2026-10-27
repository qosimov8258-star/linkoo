import { NextResponse, type NextRequest } from "next/server"

import { requireFieldReader, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { listFieldEmployees } from "@/lib/field-activity/employees"
import { lastLocations } from "@/lib/field-activity/gps-repo"
import { badQuery, fieldRoute, idParam } from "@/lib/field-activity/http"
import { boolParam, dayParam, dayStartMs } from "@/lib/field-activity/input"
import { dayStatus } from "@/lib/field-activity/routes-repo"
import { FIELD_GROUPS, type FieldGroup } from "@/lib/field-activity/types"
import { todayIso } from "@/lib/finance/dates"

const DAY_MS = 24 * 60 * 60_000

// GET /api/field-activity/employees — field employees with their live location and their day:
// ?date (local day, default today) &group=all|agent|merch|delivery|collector|other &branchId
// &tracked=true (only "Показывать в отслеживании") &includeInactive=true.
// → {date, rows: [FieldEmployee & {location: LastLocation, done, todo, unplanned}]}. For a past
// date the location is the last point of that day. A reader restricted to their own data gets
// only their employee.
export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const params = request.nextUrl.searchParams
  const day = dayParam(params.get("date"), "date")
  if (!day.ok) return badQuery(day)
  const groupText = (params.get("group") ?? "").trim()
  if (groupText && groupText !== "all" && !(FIELD_GROUPS as readonly string[]).includes(groupText)) return badQuery({ field: "group", error: "Неверное значение" })
  const branch = idParam(params.get("branchId"), "branchId")
  if (!branch.ok) return badQuery(branch)
  const tracked = boolParam(params.get("tracked"), "tracked")
  if (!tracked.ok) return badQuery(tracked)
  const inactive = boolParam(params.get("includeInactive"), "includeInactive")
  if (!inactive.ok) return badQuery(inactive)
  return fieldRoute(async () => {
    const employees = await listFieldEmployees({
      activeOnly: !inactive.value,
      trackedOnly: Boolean(tracked.value),
      branchId: branch.value,
      groups: groupText && groupText !== "all" ? [groupText as FieldGroup] : undefined,
      employeeIds: scopedEmployeeIds(reader.scope, undefined),
    })
    const ids = employees.map((employee) => employee.employeeId)
    const until = day.value < todayIso() ? dayStartMs(day.value) + DAY_MS : Date.now()
    const [locations, statuses] = await Promise.all([lastLocations(ids, until), dayStatus(ids, day.value)])
    const locationOf = new Map(locations.map((location) => [location.employeeId, location]))
    const statusOf = new Map(statuses.map((status) => [status.employeeId, status]))
    return NextResponse.json({
      date: day.value,
      rows: employees.map((employee) => {
        const status = statusOf.get(employee.employeeId)
        return {
          ...employee,
          location: locationOf.get(employee.employeeId) ?? null,
          done: status?.done ?? 0,
          todo: status?.todo ?? 0,
          unplanned: status?.unplanned ?? 0,
        }
      }),
    })
  })
}
