import { NextResponse, type NextRequest } from "next/server"

import { requireFieldReader, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { badQuery, fieldRoute } from "@/lib/field-activity/http"
import { fieldRecordFacets, listFieldRecords, recordListQueryOf } from "@/lib/field-activity/record-lists"

// GET /api/field-activity/photo-reports — the mobile app's photo reports (field_photo_reports)
// with their before / after photos, newest first, for the page "Фотоотчеты": ?from&to (local
// days, optional) &employeeId &clientId (comma lists) &status=pending,rejected,accepted &q &page
// &pageSize (1..500) &before (the previous page's nextCursor, instead of page) &facets=true.
// → {count, page, pageSize, hasMore, nextCursor, rows: FieldRecordRow[], facets?, ownEmployeeId}. A reader
// restricted to their own data sees only their employee's reports (and their supervised agents');
// ownEmployeeId names their own employee, whose reports they may not review (null for a full scope).
export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const query = recordListQueryOf("photo_report", request.nextUrl.searchParams, reader.scope)
  if (!query.ok) return badQuery(query)
  const { filter, page, pageSize, before, facets } = query.value
  return fieldRoute(async () => {
    const result = await listFieldRecords("photo_report", filter, { limit: pageSize, offset: (page - 1) * pageSize, before })
    return NextResponse.json({
      ...result,
      page,
      pageSize,
      ownEmployeeId: reader.scope.all ? null : reader.scope.employeeId,
      ...(facets ? { facets: await fieldRecordFacets("photo_report", scopedEmployeeIds(reader.scope, undefined)) } : {}),
    })
  })
}
