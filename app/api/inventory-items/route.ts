import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { inventoryErrorResponse, inventoryItemSchema, parseInventoryQuery } from "@/lib/inventory-items-api"
import { createInventoryItem, listInventoryItems } from "@/lib/inventory-items-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// GET /api/inventory-items?status=in_stock|in_market|all|attachment &… (lib/inventory-items-api.ts) → InventoryItemListResult
// POST /api/inventory-items — "Добавление инвентаря" → InventoryItemDetail (201)
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseInventoryQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listInventoryItems(parsed.data))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, inventoryItemSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await createInventoryItem(parsed.data, auth.user), { status: 201 })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}
