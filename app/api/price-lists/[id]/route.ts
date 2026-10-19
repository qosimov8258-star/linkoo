import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { priceListBodySchema, toPriceListInput } from "@/lib/price-lists-api"
import { deletePriceList, getPriceList, priceListErrorResponse, updatePriceList } from "@/lib/price-lists-repo"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Прайс-лист не найден" }

function parseId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

// GET /api/price-lists/[id] — demo GET sales/price_list/:id/; ?usage=1 adds where it is used.
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = parseId((await params).id)
  const priceList = id ? await getPriceList(id, new URL(request.url).searchParams.get("usage") === "1") : null
  if (!priceList) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(priceList)
}

// PUT /api/price-lists/[id] — demo PUT sales/price_list/:id/. Omitted fields keep their value; a
// rename is carried over in the same transaction to the item prices and every document that stores
// the price-list name (listed in `renamed`).
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, priceListBodySchema)
  if (parsed.error) return parsed.error
  try {
    const result = await updatePriceList(id, toPriceListInput(parsed.data))
    if (!result) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ...result.priceList, renamed: result.renamed })
  } catch (error) {
    const response = priceListErrorResponse(error)
    if (response) return response
    throw error
  }
}

// DELETE /api/price-lists/[id] — 409 {error: "Удаление невозможно из-за связи с другими данными", usage}
// while item prices, documents, branches, linked lists or repricings use the list.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const ok = await deletePriceList(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const response = priceListErrorResponse(error)
    if (response) return response
    throw error
  }
}
