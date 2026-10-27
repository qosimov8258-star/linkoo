import { NextResponse, type NextRequest } from "next/server"

import { requireFieldReader, scopeAllows } from "@/lib/field-activity/actor"
import { badQuery } from "@/lib/field-activity/http"
import { dayParam } from "@/lib/field-activity/input"
import { trackingRoute } from "@/lib/tracking-http"
import { startLocations } from "@/lib/tracking-route"
import { invalidIdResponse, NOT_FOUND_MESSAGE, parseIdSegment } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/tracking/agents/[id]/start-locations?date=YYYY-MM-DD — the start / finish choices
// of the route optimisation: {rows: StartLocation[]} = the agent's last location of that day
// (id 0, name "Последняя локация", only when known) and every active warehouse with coordinates.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const day = dayParam(request.nextUrl.searchParams.get("date"), "date")
  if (!day.ok) return badQuery(day)
  if (!scopeAllows(reader.scope, id)) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 })
  return trackingRoute(async () => NextResponse.json({ rows: await startLocations(id, day.value) }))
}
