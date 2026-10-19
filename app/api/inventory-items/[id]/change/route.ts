import { NextResponse } from "next/server"

import { inventoryChangeSchema, inventoryErrorResponse, parseInventoryId } from "@/lib/inventory-items-api"
import { NOT_FOUND, changeInventoryClient } from "@/lib/inventory-items-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// POST /api/inventory-items/[id]/change { takeDate?, giveClientId?, giveDate?, condition?, comment? }
// — "Передача / Изъятие": "Изъять с клиента" (take) and / or "Передать клиенту" (give).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseInventoryId((await params).id)
  if (!id) return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
  const parsed = await parseJsonBody(request, inventoryChangeSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await changeInventoryClient(id, parsed.data, auth.user))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}
