import { NextResponse, type NextRequest } from "next/server"

import { requireFieldReader, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { badQuery, fieldRoute, idParam } from "@/lib/field-activity/http"
import { idsParam, routeClientsSchema, routePlanSchema } from "@/lib/field-activity/input"
import { listRoutePlans, removeRoutePlans, upsertRoutePlans } from "@/lib/field-activity/routes-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// Planned routes ("visit days") of the field employees (lib/field-activity/routes-repo.ts).
//   GET    ?employeeId (comma list) &clientId → {rows: RoutePlan[]} in route order
//   PUT    {employeeId, clientIds (1..500), weekdays (ISO 1..7), intervalWeeks? (1..4, default 1),
//           startDate? (YYYY-MM-DD, default today)} → {rows} — creates or replaces the plans
//   DELETE {employeeId, clientIds} → {removed}
// Writes need clients.manage ("Клиенты, маршруты, задачи и опросы", lib/capabilities-catalog.ts).

export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const params = request.nextUrl.searchParams
  const ids = idsParam(params, "employeeId")
  if (!ids.ok) return badQuery(ids)
  const client = idParam(params.get("clientId"), "clientId")
  if (!client.ok) return badQuery(client)
  return fieldRoute(async () =>
    NextResponse.json({
      rows: await listRoutePlans({ employeeIds: scopedEmployeeIds(reader.scope, ids.value.length ? ids.value : undefined), clientId: client.value }),
    }),
  )
}

export async function PUT(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, routePlanSchema)
  if (parsed.error) return parsed.error
  return fieldRoute(async () => NextResponse.json({ rows: await upsertRoutePlans(parsed.data, auth.user.id) }))
}

export async function DELETE(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, routeClientsSchema)
  if (parsed.error) return parsed.error
  return fieldRoute(async () => NextResponse.json({ removed: await removeRoutePlans(parsed.data) }))
}
