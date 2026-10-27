import { NextResponse, type NextRequest } from "next/server"

import { requireFieldReader } from "@/lib/field-activity/actor"
import { fieldEventTotals } from "@/lib/field-activity/events"
import { badQuery, eventQueryOf, fieldRoute } from "@/lib/field-activity/http"

// GET /api/field-activity/summary — counts and sums of the field event stream per kind and per
// employee, with the same filter as /api/field-activity/events (so a header count equals the
// number of cards the list can load). → FieldTotals {baseCurrency, byKind, byEmployee}.
export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const query = eventQueryOf(request.nextUrl.searchParams, reader.scope)
  if (!query.ok) return badQuery(query)
  return fieldRoute(async () => NextResponse.json(await fieldEventTotals(query.value)))
}
