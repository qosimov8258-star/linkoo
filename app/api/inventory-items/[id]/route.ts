import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteInventoryItem, updateInventoryItem, type InventoryItemInput } from "@/lib/inventory-items-repo"

const inventoryItemSchema = z.object({
  inventoryType: z.string().trim().min(1),
  serialNumber: z.string().optional(),
  client: z.string().optional(),
  inventoryCode: z.string().optional(),
  warehouse: z.string().optional(),
  condition: z.string().optional(),
  responsible: z.string().optional(),
  attachDate: z.string().optional(),
  checkDate: z.string().optional(),
  approved: z.boolean().optional(),
})

function toInventoryItemInput(data: z.infer<typeof inventoryItemSchema>): InventoryItemInput {
  return {
    serialNumber: data.serialNumber ?? "",
    client: data.client ?? "",
    inventoryType: data.inventoryType,
    inventoryCode: data.inventoryCode ?? "",
    warehouse: data.warehouse ?? "",
    condition: data.condition ?? "",
    responsible: data.responsible ?? "",
    attachDate: data.attachDate ?? "",
    checkDate: data.checkDate ?? "",
    approved: data.approved ?? false,
  }
}

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, inventoryItemSchema)
  if (parsed.error) return parsed.error

  const item = (await updateInventoryItem(id, toInventoryItemInput(parsed.data)))
  if (!item) return NextResponse.json({ error: "Инвентарь не найден" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteInventoryItem(id))
  if (!ok) return NextResponse.json({ error: "Инвентарь не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
