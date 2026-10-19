import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { addSupplierReserve } from "@/lib/suppliers-repo"

const reserveSchema = z.object({
  products: z
    .array(
      z.object({
        product: z.string().trim().min(1),
        qty: z.coerce.number().finite().positive(),
        price: z.coerce.number().finite().min(0).default(0),
        currency: z.string().trim().default("SUM"),
      }),
    )
    .min(1),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, reserveSchema)
  if (parsed.error) return parsed.error
  const supplier = await addSupplierReserve(Number((await params).id), parsed.data.products)
  if (!supplier) return NextResponse.json({ error: "Поставщик не найден" }, { status: 404 })
  return NextResponse.json(supplier)
}
