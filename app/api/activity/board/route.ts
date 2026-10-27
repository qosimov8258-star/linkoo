import { NextResponse, type NextRequest } from "next/server"

import { activityBoard, activityQueryOf } from "@/lib/activity-repo"
import { requireFieldReader } from "@/lib/field-activity/actor"
import { badQuery, fieldRoute } from "@/lib/field-activity/http"

// GET /api/activity/board — the Активность page's agent strip and column header totals:
// ?from&to (local days, default today) &employeeId (the selected agent card: narrows the column
// totals, not the strip) &clientTypeId (comma list) &withEquipment=true|false &branchId.
// → ActivityBoard {from, to, baseCurrency, employeeId, totalVisits, columns, agents}.
// Read scope of lib/field-activity/actor.ts: a reader restricted to their own data gets only
// their employee; any other user without the scope gets 403.
export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const query = activityQueryOf(request.nextUrl.searchParams)
  if (!query.ok) return badQuery(query)
  return fieldRoute(async () => NextResponse.json(await activityBoard(query.value, reader.scope)))
}
