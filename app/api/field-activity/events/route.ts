import { NextResponse, type NextRequest } from "next/server"

import { requireFieldReader } from "@/lib/field-activity/actor"
import { listFieldEvents } from "@/lib/field-activity/events"
import { badQuery, eventQueryOf, fieldRoute } from "@/lib/field-activity/http"
import { pageParams } from "@/lib/field-activity/input"
import { MAX_PAGE_SIZE } from "@/lib/field-activity/types"

// GET /api/field-activity/events — one page of the field event stream (lib/field-activity/events.ts):
// ?from&to (local days, default today) &kind=order,delivery,payment,return,visit,refusal,photo_report
// &employeeId &clientId &clientTypeId (comma lists) &branchId &withEquipment=true|false
// &onlyAttributed &excludeCancelled &page (1..) &pageSize (1..500, default 25).
// → {count, page, pageSize, hasMore, baseCurrency, rows: FieldEvent[]}. A reader restricted to
// their own data sees only their employee's events.
export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const params = request.nextUrl.searchParams
  const query = eventQueryOf(params, reader.scope)
  if (!query.ok) return badQuery(query)
  const paging = pageParams(params, MAX_PAGE_SIZE)
  if (!paging.ok) return badQuery(paging)
  const { page, pageSize } = paging.value
  return fieldRoute(async () => {
    const result = await listFieldEvents(query.value, { limit: pageSize, offset: (page - 1) * pageSize })
    return NextResponse.json({ ...result, page, pageSize, hasMore: page * pageSize < result.count })
  })
}
