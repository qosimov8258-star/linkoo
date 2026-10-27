import { NextResponse, type NextRequest } from "next/server"

import { activityFeed, activityPageOf, activityQueryOf } from "@/lib/activity-repo"
import { requireFieldReader } from "@/lib/field-activity/actor"
import { badQuery, fieldRoute } from "@/lib/field-activity/http"

// GET /api/activity/feed — one page of one Активность column, newest first:
// ?column=order|refusal|photo_report|return|payment|delivery (required) &page (1..)
// &pageSize (1..100, default 25) plus the board filter (from, to, employeeId, clientTypeId,
// withEquipment, branchId). → ActivityFeedPage {column, count, page, pageSize, hasMore,
// baseCurrency, rows}. `count` equals the column total of /api/activity/board.
export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const params = request.nextUrl.searchParams
  const page = activityPageOf(params)
  if (!page.ok) return badQuery(page)
  const query = activityQueryOf(params)
  if (!query.ok) return badQuery(query)
  return fieldRoute(async () => NextResponse.json(await activityFeed(query.value, page.value, reader.scope)))
}
