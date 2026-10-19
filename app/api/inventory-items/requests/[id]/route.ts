import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseInventoryId } from "@/lib/inventory-items-api"
import { getInventoryRequest } from "@/lib/inventory-items-requests"

// GET /api/inventory-items/requests/[id] → InventoryRequest.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = parseInventoryId((await params).id)
  const item = id ? await getInventoryRequest(id) : null
  if (!item) return NextResponse.json({ error: "Запрос не найден" }, { status: 404 })
  return NextResponse.json(item)
}
