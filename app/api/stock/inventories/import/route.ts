import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { inventoryImportSchema, parseInventoryBody, stockInventoryErrorResponse } from "@/lib/stock-inventories-api"
import { importStockInventory } from "@/lib/stock-inventories-repo"

// POST /api/stock/inventories/import {type, warehouse, invDate?, forDayEnd?, comment?,
// rows:[{name?, article?, amount, line?}]} → 201 StockInventoryDetail (pending), the rows of the
// filled template parsed in the browser (demo POST stock/inventory/import_excel/). 400 with
// `missing` (unknown names) or `lines` (bad amounts) rejects the whole file.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseInventoryBody(request, inventoryImportSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await importStockInventory(parsed.data, auth.user), { status: 201 })
  } catch (error) {
    return stockInventoryErrorResponse(error)
  }
}
