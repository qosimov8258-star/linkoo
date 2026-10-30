import { NextResponse, type NextRequest } from "next/server"

import { requireFieldReader, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { badQuery, fieldRoute, idParam } from "@/lib/field-activity/http"
import { pageParams } from "@/lib/field-activity/input"
import { cursorParam, listClientVisitPage } from "@/lib/field-activity/record-lists"
import { RECORD_LIST_MAX_PAGE_SIZE } from "@/lib/field-activity/record-list-types"

// GET /api/field-activity/client-visits — the visits of one client that are not linked to an
// order, newest first, for the client card's ЗАДАЧИ: ?clientId (required) &pageSize (1..500,
// default 500) &before (the previous page's nextCursor).
// → {count, hasMore, nextCursor, rows: ClientVisitRow[]}. A reader restricted to their own data
// sees only their employee's visits.
export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const params = request.nextUrl.searchParams
  const client = idParam(params.get("clientId"), "clientId", true)
  if (!client.ok) return badQuery(client)
  const paging = pageParams(params, RECORD_LIST_MAX_PAGE_SIZE, RECORD_LIST_MAX_PAGE_SIZE)
  if (!paging.ok) return badQuery(paging)
  // Keyset paging only: a page number would shift when a visit arrives meanwhile.
  if (paging.value.page > 1) return badQuery({ field: "page", error: "Неверное значение" })
  const before = cursorParam(params.get("before"))
  if (!before.ok) return badQuery(before)
  return fieldRoute(async () =>
    NextResponse.json(
      await listClientVisitPage(client.value!, { limit: paging.value.pageSize, before: before.value }, scopedEmployeeIds(reader.scope, undefined)),
    ),
  )
}
