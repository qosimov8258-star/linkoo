import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteSupplierCategory, parseSupplierCategoryInput, updateSupplierCategory } from "@/lib/supplier-categories-repo"

const supplierCategorySchema = z.object({
  name: z.string().trim().min(1),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, supplierCategorySchema)
  if (parsed.error) return parsed.error

  const input = parseSupplierCategoryInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const category = (await updateSupplierCategory(id, input))
  if (!category) return NextResponse.json({ error: "Категория не найдена" }, { status: 404 })
  return NextResponse.json(category)
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteSupplierCategory(id))
  if (!ok) return NextResponse.json({ error: "Категория не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
