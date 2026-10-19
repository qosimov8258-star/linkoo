import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createRawMaterial, listRawMaterials, parseRawMaterialInput } from "@/lib/raw-materials-repo"

const priceListEntrySchema = z.object({
  name: z.string().optional(),
  cash: z.number().optional(),
  nonCash: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  currency: z.string().optional(),
  nonCashCurrency: z.string().optional(),
})

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
  perfectStore: z.boolean().optional(),
  showAsInventory: z.boolean().optional(),
  groupOnly: z.boolean().optional(),
  showInBot: z.boolean().optional(),
  trackExpiry: z.boolean().optional(),
  markedProduct: z.boolean().optional(),
  limitPrice: z.boolean().optional(),
  group: z.string().optional(),
  ikpu: z.string().optional(),
  invoiceUnitCode: z.string().optional(),
  vat: z.string().optional(),
  salePoints: z.string().optional(),
  priceLists: z.array(priceListEntrySchema).optional(),
  priceMin: z.number().optional(),
  priceMax: z.number().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
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
