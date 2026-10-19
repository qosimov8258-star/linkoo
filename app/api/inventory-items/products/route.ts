import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseInventoryId } from "@/lib/inventory-items-api"
import { listInventoryProducts } from "@/lib/inventory-items-options"

// GET /api/inventory-items/products?warehouse=<name>&includeId=<product id> → InventoryProductOption[]
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const search = new URL(request.url).searchParams
  return NextResponse.json(await listInventoryProducts((search.get("warehouse") ?? "").slice(0, 300), parseInventoryId(search.get("includeId") ?? "")))
}
