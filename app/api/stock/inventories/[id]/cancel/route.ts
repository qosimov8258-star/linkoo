import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseInventoryId, stockInventoryErrorResponse } from "@/lib/stock-inventories-api"
import { cancelStockInventory } from "@/lib/stock-inventories-repo"

type RouteParams = { params: Promise<{ id: string }> }

// POST (or PUT, as the demo's stock/inventory/:id/cancel_accept/) /api/stock/inventories/[id]/cancel
// → StockInventoryDetail. Confirmed only (409 otherwise): the stock core stops counting its difference.
export async function POST(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseInventoryId((await params).id)
  if (!id) return NextResponse.json({ error: "Инвентаризация не найдена" }, { status: 404 })
  try {
    return NextResponse.json(await cancelStockInventory(id, auth.user))
  } catch (error) {
    return stockInventoryErrorResponse(error)
  }
}

export const PUT = POST
