import { NextResponse, type NextRequest } from "next/server"

import { requireFieldReader, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { badQuery, fieldRoute } from "@/lib/field-activity/http"
import { idsParam } from "@/lib/field-activity/input"
import { clientFieldCounts, countPeriodOf } from "@/lib/field-activity/record-lists"

// GET /api/field-activity/client-counts — visits, refusals and photo reports per client in a
// period (Анализ покрытия): ?from&to (local days, default today; any length, unlike the event
// lists, so the page's Визит / Отказ cover the same period as its other columns) &employeeId
// &clientId (comma lists). → {from, to, rows: [{clientId, visits, refusals, photoReports}]}.
// A reader restricted to their own data counts only their employee's records.
export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const params = request.nextUrl.searchParams
  const period = countPeriodOf(params)
  if (!period.ok) return badQuery(period)
  const employees = idsParam(params, "employeeId")
  if (!employees.ok) return badQuery(employees)
  const clients = idsParam(params, "clientId", 5000)
  if (!clients.ok) return badQuery(clients)
  const { from, to } = period.value
  return fieldRoute(async () =>
    NextResponse.json({
      from,
      to,
      rows: await clientFieldCounts(from, to, {
        employeeIds: scopedEmployeeIds(reader.scope, employees.value.length ? employees.value : undefined),
        clientIds: clients.value.length ? clients.value : undefined,
      }),
    }),
  )
}
