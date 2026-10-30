import { NextResponse } from "next/server"

import { fieldWriteScope, scopeAllows } from "@/lib/field-activity/actor"
import { FIELD_MESSAGES } from "@/lib/field-activity/errors"
import { badQuery, fieldRoute } from "@/lib/field-activity/http"
import { routeClientsSchema } from "@/lib/field-activity/input"
import { reorderRoutePlans } from "@/lib/field-activity/routes-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// PUT /api/field-activity/route-plans/order {employeeId, clientIds} — sets the route order of the
// employee's planned clients (positions 1..n in the given order; every client must be planned
// for the employee, else 400). → {rows: RoutePlan[]}. Needs clients.manage and the employee inside
// the writer's field scope (else 400 employeeId, like an unknown one). Used by the route
// optimisation of Отслеживание (the page computes the order, this stores it).
export async function PUT(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, routeClientsSchema)
  if (parsed.error) return parsed.error
  const access = await fieldWriteScope(auth.user)
  if (access.error) return access.error
  if (!scopeAllows(access.scope, parsed.data.employeeId)) return badQuery({ field: "employeeId", error: FIELD_MESSAGES.employeeNotFound })
  return fieldRoute(async () => NextResponse.json({ rows: await reorderRoutePlans(parsed.data) }))
}
