import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createSupplierReturn, listSupplierReturns, parseSupplierReturnInput } from "@/lib/supplier-returns-repo"

const supplierReturnSchema = z.object({
  fromWhom: z.string().trim().min(1),
  warehouse: z.string().trim().min(1),
  organization: z.string().optional(),
  branch: z.string().optional(),
  currency: z.string().optional(),
  priceList: z.string().optional(),
  paymentType: z.string().optional(),
  date: z.string().optional(),
  comment: z.string().optional(),
  items: z.array(z.record(z.string(), z.unknown())).min(1),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listSupplierReturns()))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, supplierReturnSchema)
  if (parsed.error) return parsed.error

  const input = parseSupplierReturnInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Поставщик, склад и товары обязательны" }, { status: 400 })

  return NextResponse.json((await createSupplierReturn(input)), { status: 201 })
}
