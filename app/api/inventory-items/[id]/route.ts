import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { inventoryErrorResponse, inventoryItemSchema, parseInventoryId } from "@/lib/inventory-items-api"
import { NOT_FOUND, deleteInventoryItem, getInventoryItem, updateInventoryItem } from "@/lib/inventory-items-repo"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// GET → InventoryItemDetail; PUT — "Изменение инвентаря"; DELETE — soft delete (409 while a request is pending).
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseInventoryId((await params).id)
  const item = id ? await getInventoryItem(id) : null
  if (!item) return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
  return NextResponse.json(item)
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseInventoryId((await params).id)
  if (!id) return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
  const parsed = await parseJsonBody(request, inventoryItemSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await updateInventoryItem(id, parsed.data))
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseInventoryId((await params).id)
  if (!id) return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
  try {
    await deleteInventoryItem(id, auth.user)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return inventoryErrorResponse(error)
  }
}
