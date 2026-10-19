import { NextResponse } from "next/server"

import { inventoryErrorResponse, inventoryRequestConfirmSchema, parseInventoryId } from "@/lib/inventory-items-api"
import { confirmInventoryRequest } from "@/lib/inventory-items-requests"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// POST /api/inventory-items/requests/[id]/confirm { itemId? } — "Подтвердить" (attach needs an item in a warehouse).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseInventoryId((await params).id)
  if (!id) return NextResponse.json({ error: "Запрос не найден" }, { status: 404 })
  const parsed = await parseJsonBody(request, inventoryRequestConfirmSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await confirmInventoryRequest(id, parsed.data.itemId ?? null, auth.user))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}
