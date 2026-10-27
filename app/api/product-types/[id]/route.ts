import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { productTypeBodySchema, productTypeInput } from "@/lib/dictionaries-api"
import { dictionaryWrite, parseDictionaryId } from "@/lib/dictionaries-schema"
import { deleteProductType, getProductTypeDetail, updateProductType } from "@/lib/product-types-repo"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Тип продукта не найден" }

// GET /api/product-types/[id] — the type with parentName / childCount; ?usage=1 adds where it is used.
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseDictionaryId((await params).id)
  const type = id ? await getProductTypeDetail(id, new URL(request.url).searchParams.get("usage") === "1") : null
  if (!type) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(type)
}

// PUT /api/product-types/[id] — omitted fields keep their value; a rename / move is carried
// into products and raw materials in the same transaction (listed in `renamed`).
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseDictionaryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, productTypeBodySchema)
  if (parsed.error) return parsed.error
  return dictionaryWrite(async () => {
    const result = await updateProductType(id, productTypeInput(parsed.data))
    if (!result) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ...result.type, renamed: result.renamed })
  })
}

// DELETE /api/product-types/[id] — 409 {error, usage} while items use the type or it has children.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseDictionaryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  return dictionaryWrite(async () => {
    if (!(await deleteProductType(id))) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  })
}
