import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { requireFieldActor, requireFieldReader, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { badQuery, fieldRoute } from "@/lib/field-activity/http"
import { fieldRecordFacets, listFieldRecords, recordListQueryOf, type FieldRecordOrder } from "@/lib/field-activity/record-lists"
import { RECORD_LIST_MAX_PAGE_SIZE } from "@/lib/field-activity/record-list-types"
import { createOfficeRefusal } from "@/lib/field-activity/visits-repo"
import { parseJsonBody } from "@/lib/validation"

// GET /api/field-activity/refusals — the mobile app's visit refusals (field_refusals), newest
// first, for the Продажи page "Отказы": ?from&to (local days, optional) &employeeId &clientId
// &refusalTypeId (comma lists) &q &page &pageSize (1..2000, Linko's page size menu) &before (the previous page's
// nextCursor, instead of page) &ordering (Linko's header sort: id | createdDate | name | market | comment, "-" for
// descending; not with before) &facets=true.
// → {count, page, pageSize, hasMore, nextCursor, rows: FieldRecordRow[], facets?}. A reader restricted to
// their own data sees only their employee's refusals.

/** Linko's «25 ▾» menu of the Отказы page goes up to 2000 rows a page. */
const MAX_PAGE_SIZE = 2000
const ORDER_KEYS: readonly FieldRecordOrder["key"][] = ["id", "createdDate", "name", "market", "comment"]

function orderingOf(value: string | null): { ok: true; value?: FieldRecordOrder } | { ok: false; field: string; error: string } {
  const text = (value ?? "").trim()
  if (!text) return { ok: true }
  const desc = text.startsWith("-")
  const key = (desc ? text.slice(1) : text) as FieldRecordOrder["key"]
  return ORDER_KEYS.includes(key) ? { ok: true, value: { key, desc } } : { ok: false, field: "ordering", error: "Неверное значение" }
}

export async function GET(request: NextRequest) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const params = new URLSearchParams(request.nextUrl.searchParams)
  // The shared list parser stops at RECORD_LIST_MAX_PAGE_SIZE; this page also takes Linko's 1000 / 2000.
  const wanted = (params.get("pageSize") ?? "").trim()
  const bigPage = /^\d{1,4}$/.test(wanted) && Number(wanted) > RECORD_LIST_MAX_PAGE_SIZE && Number(wanted) <= MAX_PAGE_SIZE ? Number(wanted) : 0
  if (bigPage) params.set("pageSize", String(RECORD_LIST_MAX_PAGE_SIZE))
  const query = recordListQueryOf("refusal", params, reader.scope)
  if (!query.ok) return badQuery(query)
  const order = orderingOf(params.get("ordering"))
  if (!order.ok) return badQuery(order)
  const { filter, page, before, facets } = query.value
  const pageSize = bigPage || query.value.pageSize
  // A cursor follows the default order (newest first): with a header sort only numbered pages make sense.
  if (before && order.value) return badQuery({ field: "ordering", error: "Неверное значение" })
  return fieldRoute(async () => {
    const result = await listFieldRecords("refusal", filter, { limit: pageSize, offset: (page - 1) * pageSize, before, order: order.value })
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
