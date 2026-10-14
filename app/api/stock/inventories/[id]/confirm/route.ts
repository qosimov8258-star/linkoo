import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { inventoryConfirmSchema, parseInventoryBody, parseInventoryId, stockInventoryErrorResponse } from "@/lib/stock-inventories-api"
import { confirmStockInventory } from "@/lib/stock-inventories-repo"

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/stock/inventories/[id]/confirm {comment?} → StockInventoryDetail (demo POST
// stock/inventory/:id/confirm/). Freezes balance_amount, diff, cost and total_price from the
// stock core in one transaction; 409 when it is not pending any more (double confirm).
export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseInventoryId((await params).id)
  if (!id) return NextResponse.json({ error: "Инвентаризация не найдена" }, { status: 404 })
  const parsed = await parseInventoryBody(request, inventoryConfirmSchema, true)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await confirmStockInventory(id, parsed.data.comment, auth.user))
  } catch (error) {
    return stockInventoryErrorResponse(error)
  }
}
