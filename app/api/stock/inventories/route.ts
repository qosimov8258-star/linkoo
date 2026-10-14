import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { inventoryInputSchema, parseInventoryBody, parseInventoryListQuery, stockInventoryErrorResponse } from "@/lib/stock-inventories-api"
import { createStockInventory, listStockInventories } from "@/lib/stock-inventories-repo"

// GET /api/stock/inventories?search&status&warehouse*&createdBy*&fromDate&toDate&ordering&page&pageSize
// → {count, results} (demo GET stock/inventory/?page_size=25). POST {type, warehouse, invDate?,
// forDayEnd?, comment?, items:[{key, amount, series?}]} → 201 StockInventoryDetail (status pending).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseInventoryListQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listStockInventories(parsed.data))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseInventoryBody(request, inventoryInputSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await createStockInventory(parsed.data, auth.user), { status: 201 })
  } catch (error) {
    return stockInventoryErrorResponse(error)
  }
}
