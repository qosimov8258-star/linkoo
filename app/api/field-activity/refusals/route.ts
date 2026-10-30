import { NextResponse, type NextRequest } from "next/server"

import { requireFieldReader, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { badQuery, fieldRoute } from "@/lib/field-activity/http"
import { fieldRecordFacets, listFieldRecords, recordListQueryOf } from "@/lib/field-activity/record-lists"

// GET /api/field-activity/refusals — the mobile app's visit refusals (field_refusals), newest
// first, for the Продажи page "Отказы": ?from&to (local days, optional) &employeeId &clientId
// &refusalTypeId (comma lists) &q &page &pageSize (1..500) &before (the previous page's
// nextCursor, instead of page) &facets=true.
// → {count, page, pageSize, hasMore, nextCursor, rows: FieldRecordRow[], facets?}. A reader restricted to
// their own data sees only their employee's refusals.
export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const query = recordListQueryOf("refusal", request.nextUrl.searchParams, reader.scope)
  if (!query.ok) return badQuery(query)
  const { filter, page, pageSize, before, facets } = query.value
  return fieldRoute(async () => {
    const result = await listFieldRecords("refusal", filter, { limit: pageSize, offset: (page - 1) * pageSize, before })
    return NextResponse.json({
      ...result,
      page,
      pageSize,
      ...(facets ? { facets: await fieldRecordFacets("refusal", scopedEmployeeIds(reader.scope, undefined)) } : {}),
    })
  })
}
