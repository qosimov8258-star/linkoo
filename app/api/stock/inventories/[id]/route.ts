import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { inventoryInputSchema, parseInventoryBody, parseInventoryId, stockInventoryErrorResponse } from "@/lib/stock-inventories-api"
import { deleteStockInventory, getStockInventory, updateStockInventory } from "@/lib/stock-inventories-repo"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Инвентаризация не найдена" }

// GET /api/stock/inventories/[id] → StockInventoryDetail (demo GET stock/inventory/:id/);
// a pending inventory carries the live system balances (live: true).
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
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

// DELETE — pending only (409 otherwise; a confirmed inventory is cancelled instead).
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseInventoryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    await deleteStockInventory(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return stockInventoryErrorResponse(error)
  }
}
