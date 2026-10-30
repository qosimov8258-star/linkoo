import { NextRequest, NextResponse } from "next/server"

import { getAgentRouteSummary, getRoutesBoard, getVisitStats, getWorkTime } from "@/lib/agent-visits-repo"
import { requireFieldReader, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { badQuery, fieldRoute } from "@/lib/field-activity/http"
import { dayParam, periodParams } from "@/lib/field-activity/input"

/**
 * Field-agent visit analytics, read from the field activity data (lib/agent-visits-repo.ts).
 * Readers as for Активность / Отслеживание: everyone with the full scope, a field employee
 * only their own data.
 *
 * GET /api/agent-visits?date=YYYY-MM-DD → the route board of "Анализ маршрутов";
 * GET /api/agent-visits?view=routes&from=…&to=… → per agent plan / visits / refusals / sales of a period;
 * GET /api/agent-visits?view=stats&begin=…&end=… → per-agent visit statistics (dashboard widget);
 * GET /api/agent-visits?view=work-time&begin=…&end=… → per agent and day working-time facts.
 * A client's visits are paged by GET /api/field-activity/client-visits.
 */
export async function GET(request: NextRequest) {
  return fieldRoute(async () => {
    const reader = await requireFieldReader()
    if (reader.error) return reader.error
    const employeeIds = scopedEmployeeIds(reader.scope, undefined)
    const params = request.nextUrl.searchParams
    const view = (params.get("view") ?? "").trim()

    if (view === "routes") {
      const period = periodParams(params)
      if (!period.ok) return badQuery(period)
      return NextResponse.json(await getAgentRouteSummary(period.value.from, period.value.to, employeeIds))
    }
    if (view === "stats" || view === "work-time") {
      const period = periodParams(params, "begin", "end")
      if (!period.ok) return badQuery(period)
      const { from, to } = period.value
      return NextResponse.json(view === "stats" ? await getVisitStats(from, to, employeeIds) : await getWorkTime(from, to, employeeIds))
    }
    if (view) return badQuery({ field: "view", error: "Неверное значение" })

    const date = dayParam(params.get("date"), "date")
    if (!date.ok) return badQuery(date)
    return NextResponse.json(await getRoutesBoard(date.value, employeeIds))
  })
}
