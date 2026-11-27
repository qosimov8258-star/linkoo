import { NextRequest, NextResponse } from "next/server"

import { getAgentRouteSummary, getRoutesBoard, getStoreTime, getVisitStats, getWorkTime, WORK_TIME_BASES, type WorkTimeBasis } from "@/lib/agent-visits-repo"
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
 * GET /api/agent-visits?view=work-time&begin=…&end=…[&dataType=service_time|today_plan] → per agent and day working-time
 *   facts of Время работы агента, «Показать по» «Время нахождения» (service_time, the default) or «Задачи» (today_plan);
 * GET /api/agent-visits?view=store-time&from=…&to=… → the visits with a measured stay (Время нахождения в магазинах).
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
    if (view === "store-time") {
      const period = periodParams(params)
      if (!period.ok) return badQuery(period)
      return NextResponse.json(await getStoreTime(period.value.from, period.value.to, employeeIds))
    }
    if (view === "stats" || view === "work-time") {
      const period = periodParams(params, "begin", "end")
      if (!period.ok) return badQuery(period)
      const { from, to } = period.value
      if (view === "stats") return NextResponse.json(await getVisitStats(from, to, employeeIds))
      const dataType = (params.get("dataType") ?? "").trim() || "service_time"
      if (!WORK_TIME_BASES.includes(dataType as WorkTimeBasis)) return badQuery({ field: "dataType", error: "Неверное значение" })
      return NextResponse.json(await getWorkTime(from, to, employeeIds, dataType as WorkTimeBasis))
    }
    if (view) return badQuery({ field: "view", error: "Неверное значение" })

    const date = dayParam(params.get("date"), "date")
    if (!date.ok) return badQuery(date)
    return NextResponse.json(await getRoutesBoard(date.value, employeeIds))
  })
}
