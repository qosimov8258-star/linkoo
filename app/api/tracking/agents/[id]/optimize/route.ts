import { NextResponse } from "next/server"

import { fieldWriteScope, scopeAllows } from "@/lib/field-activity/actor"
import { requirePermission } from "@/lib/rbac"
import { trackingRoute } from "@/lib/tracking-http"
import { optimizeRoute, optimizeSchema } from "@/lib/tracking-route"
import { invalidIdResponse, NOT_FOUND_MESSAGE, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/tracking/agents/[id]/optimize {date, startClientId?, finishClientId?,
// startLocationId? (0 = the agent's last location, else a warehouse), finishLocationId?} —
// "ОПТИМИЗАЦИЯ МАРШРУТА": saves a short visiting order of the employee's planned clients of that
// day as the route order. → {clientIds} in the new order. Needs clients.manage (routes);
// 400 for no plans, a client not on the day's route, an unknown warehouse or one without
// coordinates; 404 for an unknown employee or one outside the caller's field scope
// (lib/field-activity/actor.ts: an agent optimises only their own route and their agents' routes).
export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requirePermission("clients.manage")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const parsed = await parseJsonBody(request, optimizeSchema)
  if (parsed.error) return parsed.error
  const access = await fieldWriteScope(auth.user)
  if (access.error) return access.error
  if (!scopeAllows(access.scope, id)) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 })
  return trackingRoute(async () => NextResponse.json({ clientIds: await optimizeRoute(id, parsed.data) }))
}
