import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createRawMaterial, listRawMaterials, parseRawMaterialInput } from "@/lib/raw-materials-repo"

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

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listRawMaterials()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, rawMaterialSchema)
  if (parsed.error) return parsed.error

  const input = parseRawMaterialInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование и мера обязательны" }, { status: 400 })

  const material = (await createRawMaterial(input))
  return NextResponse.json(material, { status: 201 })
}
