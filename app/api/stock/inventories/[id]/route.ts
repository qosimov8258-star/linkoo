import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { inventoryDeleteSchema, inventoryInputSchema, parseInventoryBody, parseInventoryId, stockInventoryErrorResponse } from "@/lib/stock-inventories-api"
import { deleteStockInventory, getStockInventory, updateStockInventory } from "@/lib/stock-inventories-repo"
import { notSignedInResponse } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Инвентаризация не найдена" }

// GET /api/stock/inventories/[id] → StockInventoryDetail (demo GET stock/inventory/:id/), with the values stored on
// the document (a pending one: those of its last save).
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseInventoryId((await params).id)
  const detail = id ? await getStockInventory(id) : null
  if (!detail) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(detail)
}

// PUT — same body as POST /api/stock/inventories; 409 unless pending (the type never changes).
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseInventoryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseInventoryBody(request, inventoryInputSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await updateStockInventory(id, parsed.data))
  } catch (error) {
    return stockInventoryErrorResponse(error)
  }
}

// DELETE {comment?} (Linko's «Удаление»: DELETE stock/inventory/:id/ with the comment) — pending or confirmed (409 when
// cancelled, or while a confirmed surplus has already left the warehouse); the comment is kept in stock_inventory_deletions.
export async function DELETE(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseInventoryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseInventoryBody(request, inventoryDeleteSchema, true)
  if (parsed.error) return parsed.error
  try {
    await deleteStockInventory(id, parsed.data.comment, auth.user)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return stockInventoryErrorResponse(error)
  }
}
