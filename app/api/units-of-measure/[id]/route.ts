import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { unitBodySchema, unitInput } from "@/lib/dictionaries-api"
import { dictionaryWrite, parseDictionaryId } from "@/lib/dictionaries-schema"
import { requireRole } from "@/lib/rbac"
import { deleteUnitOfMeasure, getUnitDetail, updateUnitOfMeasure } from "@/lib/units-of-measure-repo"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Единица измерения не найдена" }

// GET /api/units-of-measure/[id] — the unit with parentName / childCount; ?usage=1 adds where it is used.
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseDictionaryId((await params).id)
  const unit = id ? await getUnitDetail(id, new URL(request.url).searchParams.get("usage") === "1") : null
  if (!unit) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(unit)
}

// PUT /api/units-of-measure/[id] — omitted fields keep their value; a rename is carried into
// the items and the document lines in the same transaction (listed in `renamed`).
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseDictionaryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, unitBodySchema)
  if (parsed.error) return parsed.error
  return dictionaryWrite(async () => {
    const result = await updateUnitOfMeasure(id, unitInput(parsed.data))
    if (!result) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ...result.unit, renamed: result.renamed })
  })
}

// DELETE /api/units-of-measure/[id] — 409 {error, usage} while anything uses the unit or it has children.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseDictionaryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  return dictionaryWrite(async () => {
    if (!(await deleteUnitOfMeasure(id))) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  })
}
