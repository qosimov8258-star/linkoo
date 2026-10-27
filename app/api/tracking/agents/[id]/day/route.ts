import { NextResponse, type NextRequest } from "next/server"

import { requireFieldReader, scopeAllows } from "@/lib/field-activity/actor"
import { badQuery } from "@/lib/field-activity/http"
import { dayParam } from "@/lib/field-activity/input"
import { trackingDay } from "@/lib/tracking-day"
import { trackingRoute } from "@/lib/tracking-http"
import { invalidIdResponse, NOT_FOUND_MESSAGE, parseIdSegment } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/tracking/agents/[id]/day?date=YYYY-MM-DD (default today) — the day of a field
// employee for Отслеживание (TrackingDay, lib/tracking-types.ts): the clients of the day in
// timeline order with their events, the stats row and the counters. 404 for an unknown employee
// or one outside the reader's scope (a reader restricted to their own data sees only their own).
export async function GET(request: NextRequest, { params }: RouteParams) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const day = dayParam(request.nextUrl.searchParams.get("date"), "date")
  if (!day.ok) return badQuery(day)
  if (!scopeAllows(reader.scope, id)) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 })
  return trackingRoute(async () => {
    const result = await trackingDay(id, day.value)
    if (!result) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 })
    return NextResponse.json(result)
  })
}
