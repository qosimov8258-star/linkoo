import { NextResponse } from "next/server"

import { refRecordsBody, refRecordsWriter } from "@/app/api/ref-records/shared"
import { getCurrentUser } from "@/lib/current-user"
import { withDbErrors } from "@/lib/db-errors"
import { apiCreate, apiKind, listRecords } from "@/lib/ref-records-repo"
import { notSignedInResponse } from "@/lib/validation"

type Params = { params: Promise<{ kind: string }> }

const UNKNOWN_KIND = "Неизвестный раздел"

// GET /api/ref-records/<kind> → rows of a "Продажи" list page; POST creates a row (body = the page's row shape).
// Kinds, methods, validation and permissions: lib/ref-records-repo.ts (generic API) and lib/capabilities-catalog.ts.
export const GET = withDbErrors(async (_request: Request, { params }: Params) => {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const kind = apiKind((await params).kind)
  if (!kind) return NextResponse.json({ error: UNKNOWN_KIND }, { status: 404 })
  return NextResponse.json((await listRecords(kind)).map((record) => record.data))
})

export const POST = withDbErrors(async (request: Request, { params }: Params) => {
  const writer = await refRecordsWriter((await params).kind, "POST")
  if ("error" in writer) return writer.error
  const body = await refRecordsBody(request, writer.kind)
  if ("error" in body) return body.error
  const result = await apiCreate(writer.kind, body.data)
  if (!result.ok) return NextResponse.json({ error: result.issue.error, field: result.issue.field ?? null }, { status: result.issue.status })
  return NextResponse.json(result.record.data, { status: 201 })
})
