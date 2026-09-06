import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteRawMaterial, parseRawMaterialInput, updateRawMaterial } from "@/lib/raw-materials-repo"

const rawMaterialSchema = z.object({
  name: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  fullName: z.string().optional(),
  barcode: z.string().optional(),
  article: z.string().optional(),
  type: z.string().optional(),
  organization: z.string().optional(),
  subUnit: z.string().optional(),
  orderNumber: z.string().optional(),
  supplier: z.string().optional(),
  brand: z.string().optional(),
  minStock: z.string().optional(),
  color: z.string().optional(),
  integrationCode: z.string().optional(),
  mass: z.string().optional(),
  netWeight: z.string().optional(),
  volume: z.string().optional(),
  description: z.string().optional(),
  canSell: z.boolean().optional(),
  onlyMml: z.boolean().optional(),
  showAsInventory: z.boolean().optional(),
  groupOnly: z.boolean().optional(),
  showInBot: z.boolean().optional(),
  trackExpiry: z.boolean().optional(),
  markedProduct: z.boolean().optional(),
  priceList: z.string().optional(),
  cashPrice: z.string().optional(),
  nonCashPrice: z.string().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, rawMaterialSchema)
  if (parsed.error) return parsed.error

  const input = parseRawMaterialInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование и мера обязательны" }, { status: 400 })

  const material = (await updateRawMaterial(id, input))
  if (!material) return NextResponse.json({ error: "Сырьё не найдено" }, { status: 404 })
  return NextResponse.json(material)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteRawMaterial(id))
  if (!ok) return NextResponse.json({ error: "Сырьё не найдено" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
