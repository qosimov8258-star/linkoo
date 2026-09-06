import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteProduct, parseProductInput, updateProduct } from "@/lib/products-repo"

const priceListEntrySchema = z.object({
  name: z.string().optional(),
  cash: z.number().optional(),
  nonCash: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  currency: z.string().optional(),
  nonCashCurrency: z.string().optional(),
})

const productSchema = z.object({
  name: z.string().trim().min(1),
  fullName: z.string().optional(),
  barcode: z.string().optional(),
  article: z.string().optional(),
  type: z.string().optional(),
  organization: z.string().optional(),
  unit: z.string().optional(),
  subUnit: z.string().optional(),
  orderNumber: z.string().optional(),
  hasPhoto: z.boolean().optional(),
  canSell: z.boolean().optional(),
  isInventory: z.boolean().optional(),
  deleted: z.boolean().optional(),
  onlyMml: z.boolean().optional(),
  perfectStore: z.boolean().optional(),
  groupOnly: z.boolean().optional(),
  trackExpiry: z.boolean().optional(),
  manualDiscount: z.boolean().optional(),
  hideFromAgent: z.boolean().optional(),
  trackSeries: z.boolean().optional(),
  showInBot: z.boolean().optional(),
  markedProduct: z.boolean().optional(),
  limitPrice: z.boolean().optional(),
  group: z.string().optional(),
  ikpu: z.string().optional(),
  invoiceUnitCode: z.string().optional(),
  vat: z.string().optional(),
  salePoints: z.string().optional(),
  subcategory: z.string().optional(),
  brand: z.string().optional(),
  minStock: z.string().optional(),
  description: z.string().optional(),
  supplier: z.string().optional(),
  integrationCode: z.string().optional(),
  volume: z.string().optional(),
  weight: z.string().optional(),
  netWeight: z.string().optional(),
  color: z.string().optional(),
  priceLists: z.array(priceListEntrySchema).optional(),
  cost: z.number().optional(),
  priceMin: z.number().optional(),
  priceMax: z.number().optional(),
  priceUpdatedDate: z.string().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, productSchema)
  if (parsed.error) return parsed.error

  const input = parseProductInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const product = (await updateProduct(id, input))
  if (!product) return NextResponse.json({ error: "Товар не найден" }, { status: 404 })
  return NextResponse.json(product)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteProduct(id))
  if (!ok) return NextResponse.json({ error: "Товар не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
