import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { INVALID_DATA_MESSAGE, notSignedInResponse, parseJsonBody } from "@/lib/validation"
import { deleteWarehouse, getWarehouseDetail, updateWarehouse, warehouseErrorResponse } from "@/lib/warehouses-repo"
import { parseWarehouseId, warehouseInput, warehouseInputSchema } from "@/lib/warehouses-schema"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Склад не найден" }

// GET /api/warehouses/[id] — demo GET stock/stock/:id/ (full row); ?usage=1 adds where it is used.
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseWarehouseId((await params).id)
  const withUsage = new URL(request.url).searchParams.get("usage") === "1"
  const warehouse = id ? await getWarehouseDetail(id, withUsage) : null
  if (!warehouse) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(warehouse)
}

// PUT /api/warehouses/[id] — demo PUT stock/stock/:id. Omitted fields keep their value; a rename
// is carried over in the same transaction to every document that stores the warehouse name
// (the response lists them in `renamed`).
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseWarehouseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, warehouseInputSchema)
  if (parsed.error) return parsed.error
  const input = warehouseInput(parsed.data)
  if ("fields" in input) return NextResponse.json({ error: Object.values(input.fields)[0] ?? INVALID_DATA_MESSAGE, fields: input.fields }, { status: 400 })

  try {
    const result = await updateWarehouse(id, input.input)
    if (!result) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ...result.warehouse, renamed: result.renamed })
  } catch (error) {
    const response = warehouseErrorResponse(error)
    if (response) return response
    throw error
  }
}

// DELETE /api/warehouses/[id] — 409 {error, usage} while any document references the warehouse.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseWarehouseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const ok = await deleteWarehouse(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const response = warehouseErrorResponse(error)
    if (response) return response
    throw error
  }
}
