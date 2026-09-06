import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteSupplierReturn, parseSupplierReturnInput, updateSupplierReturn } from "@/lib/supplier-returns-repo"

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

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, supplierReturnSchema)
  if (parsed.error) return parsed.error

  const input = parseSupplierReturnInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Поставщик, склад и товары обязательны" }, { status: 400 })

  const supplierReturn = (await updateSupplierReturn(id, input))
  if (!supplierReturn) return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
  return NextResponse.json(supplierReturn)
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteSupplierReturn(id))
  if (!ok) return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
