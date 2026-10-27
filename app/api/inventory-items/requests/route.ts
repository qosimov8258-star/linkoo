import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { inventoryErrorResponse, inventoryRequestCreateSchema, parseInventoryQuery } from "@/lib/inventory-items-api"
import { createInventoryRequest, listInventoryRequests } from "@/lib/inventory-items-requests"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

// GET /api/inventory-items/requests?requestStatus&requestType&… — "Запросы" (demo main/gear_request).
// POST { type: attach|detach, clientId, productId?, itemId? (detach), comment? } → InventoryRequest (201).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseInventoryQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listInventoryRequests(parsed.data))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, inventoryRequestCreateSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await createInventoryRequest(parsed.data, auth.user), { status: 201 })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}
