import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteSupplier, parseSupplierInput, updateSupplier } from "@/lib/suppliers-repo"

const supplierSchema = z.object({
  name: z.string().trim().min(1),
  category: z.string().trim().min(1),
  address: z.string().trim().min(1),
  branch: z.string().optional(),
  organization: z.string().optional(),
  contacts: z.array(z.record(z.string(), z.unknown())).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, supplierSchema)
  if (parsed.error) return parsed.error

  const input = parseSupplierInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Название, категория и адрес обязательны" }, { status: 400 })

  const supplier = (await updateSupplier(id, input))
  if (!supplier) return NextResponse.json({ error: "Поставщик не найден" }, { status: 404 })
  return NextResponse.json(supplier)
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteSupplier(id))
  if (!ok) return NextResponse.json({ error: "Поставщик не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
