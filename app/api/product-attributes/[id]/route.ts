import { NextResponse } from "next/server"
import { z } from "zod"

import { parseCatalogId } from "@/lib/products-api"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteProductAttribute, updateProductAttribute } from "@/lib/product-attributes-repo"

const schema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
  fieldType: z.enum(["Выбор вариантов", "Текстовое поле", "Цифровое поле"]).optional(),
  allTypes: z.boolean().optional(),
  types: z.array(z.string()).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  // Non-numeric / too large ids are a 404, never a database error.
  const id = parseCatalogId((await params).id)
  if (!id) return NextResponse.json({ error: "Атрибут не найден" }, { status: 404 })
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const item = await updateProductAttribute(id, {
    name: parsed.data.name,
    fieldType: parsed.data.fieldType ?? "Выбор вариантов",
    allTypes: parsed.data.allTypes ?? true,
    types: parsed.data.types ?? [],
  })
  if (!item) return NextResponse.json({ error: "Атрибут не найден" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  // Non-numeric / too large ids are a 404, never a database error.
  const id = parseCatalogId((await params).id)
  if (!id) return NextResponse.json({ error: "Атрибут не найден" }, { status: 404 })
  if (!(await deleteProductAttribute(id))) return NextResponse.json({ error: "Атрибут не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
