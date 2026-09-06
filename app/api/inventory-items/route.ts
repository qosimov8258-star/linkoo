import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createInventoryItem, listInventoryItems, type InventoryItemInput } from "@/lib/inventory-items-repo"

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

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listInventoryItems()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, inventoryItemSchema)
  if (parsed.error) return parsed.error

  const item = (await createInventoryItem(toInventoryItemInput(parsed.data)))
  return NextResponse.json(item, { status: 201 })
}
