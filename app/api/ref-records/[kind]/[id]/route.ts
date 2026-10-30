import { NextResponse } from "next/server"

import { refRecordsBody, refRecordsWriter } from "@/app/api/ref-records/shared"
import { getCurrentUser } from "@/lib/current-user"
import { withDbErrors } from "@/lib/db-errors"
import { apiKind, apiUpdate, deleteRecord, getRecord, parseRecordId } from "@/lib/ref-records-repo"
import { NOT_FOUND_MESSAGE, invalidIdResponse, notSignedInResponse } from "@/lib/validation"

type Params = { params: Promise<{ kind: string; id: string }> }

const notFound = () => NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 })

export const GET = withDbErrors(async (_request: Request, { params }: Params) => {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const { kind: rawKind, id: rawId } = await params
  const kind = apiKind(rawKind)
  if (!kind) return NextResponse.json({ error: "Неизвестный раздел" }, { status: 404 })
  const id = parseRecordId(rawId)
  if (!id) return invalidIdResponse()
  const record = await getRecord(kind, id)
  return record ? NextResponse.json(record.data) : notFound()
})

export const PUT = withDbErrors(async (request: Request, { params }: Params) => {
  const { kind: rawKind, id: rawId } = await params
  const writer = await refRecordsWriter(rawKind, "PUT")
  if ("error" in writer) return writer.error
  const id = parseRecordId(rawId)
  if (!id) return invalidIdResponse()
  const body = await refRecordsBody(request, writer.kind)
  if ("error" in body) return body.error
  const result = await apiUpdate(writer.kind, id, body.data)
  if (!result) return notFound()
  if (!result.ok) return NextResponse.json({ error: result.issue.error, field: result.issue.field ?? null }, { status: result.issue.status })
  return NextResponse.json(result.record.data)
})

export const DELETE = withDbErrors(async (_request: Request, { params }: Params) => {
  const { kind: rawKind, id: rawId } = await params
  const writer = await refRecordsWriter(rawKind, "DELETE")
  if ("error" in writer) return writer.error
  const id = parseRecordId(rawId)
  if (!id) return invalidIdResponse()
  return (await deleteRecord(writer.kind, id)) ? NextResponse.json({ ok: true }) : notFound()
})
