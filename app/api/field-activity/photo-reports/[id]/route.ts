import { NextResponse } from "next/server"

import { requireFieldReader, scopeAllows } from "@/lib/field-activity/actor"
import { fieldRoute } from "@/lib/field-activity/http"
import { getFieldRecord } from "@/lib/field-activity/records"
import { invalidIdResponse, NOT_FOUND_MESSAGE, parseIdSegment } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/field-activity/photo-reports/[id] — one photo report with its photos (FieldRecord,
// lib/field-activity/records.ts). 404 when missing or outside the reader's scope.
export async function GET(_request: Request, { params }: RouteParams) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  return fieldRoute(async () => {
    const record = await getFieldRecord("photo_report", id)
    if (!record || !scopeAllows(reader.scope, record.employeeId)) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 })
    return NextResponse.json(record)
  })
}
