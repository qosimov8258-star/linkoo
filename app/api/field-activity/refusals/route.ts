import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { requireFieldActor, requireFieldReader, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { badQuery, fieldRoute } from "@/lib/field-activity/http"
import { fieldRecordFacets, listFieldRecords, recordListQueryOf } from "@/lib/field-activity/record-lists"
import { createOfficeRefusal } from "@/lib/field-activity/visits-repo"
import { parseJsonBody } from "@/lib/validation"

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

const officeRefusalSchema = z
  .object({
    clientId: z.number().int().positive(),
    /** A «Тип отказа», or none for «Своя причина» with its text. */
    refusalTypeId: z.number().int().positive().nullable().optional(),
    comment: z.string().trim().max(1000).optional(),
  })
  .refine((value) => value.refusalTypeId || value.comment, { message: "Выберите причину", path: ["refusalTypeId"] })

// POST /api/field-activity/refusals — Linko's «Отказ» of a client card («Создание отказа»): {clientId, refusalTypeId?,
// comment? (the text of «Своя причина»)}. As Linko, the refusal is a visit of the user who makes it (started and
// finished now, result refusal, no position). Needs an account linked to an employee. 201 {visitId, refusalId}.
export async function POST(request: Request) {
  const auth = await requireFieldActor()
  if (auth.error) return auth.error
  const parsed = await parseJsonBody(request, officeRefusalSchema)
  if (parsed.error) return parsed.error
  return fieldRoute(async () =>
    NextResponse.json(
      await createOfficeRefusal(auth.actor, { clientId: parsed.data.clientId, refusalTypeId: parsed.data.refusalTypeId ?? null, comment: parsed.data.comment ?? "" }),
      { status: 201 },
    ),
  )
}
