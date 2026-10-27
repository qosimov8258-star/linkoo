import { NextResponse } from "next/server"

import { deleteBrand, getBrandDetail, updateBrand } from "@/lib/brands-repo"
import { getCurrentUser } from "@/lib/current-user"
import { brandBodySchema, brandInput } from "@/lib/dictionaries-api"
import { dictionaryWrite, parseDictionaryId } from "@/lib/dictionaries-schema"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Бренд не найден" }

// GET /api/brands/[id] — demo GET main/brand/:id/; ?usage=1 adds where the brand is used.
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseDictionaryId((await params).id)
  const brand = id ? await getBrandDetail(id, new URL(request.url).searchParams.get("usage") === "1") : null
  if (!brand) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(brand)
}

// PUT /api/brands/[id] — omitted fields keep their value; a rename is carried into the items
// in the same transaction (listed in `renamed`).
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseDictionaryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, brandBodySchema)
  if (parsed.error) return parsed.error
  return dictionaryWrite(async () => {
    const result = await updateBrand(id, brandInput(parsed.data))
    if (!result) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ...result.brand, renamed: result.renamed })
  })
}

// DELETE /api/brands/[id] — 409 {error, usage} while anything uses the brand.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseDictionaryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  return dictionaryWrite(async () => {
    if (!(await deleteBrand(id))) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  })
}
