import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteProductAttribute, updateProductAttribute } from "@/lib/product-attributes-repo"

const schema = z.object({
  name: z.string().trim().min(1),
  fieldType: z.enum(["Выбор вариантов", "Текстовое поле", "Цифровое поле"]).optional(),
  allTypes: z.boolean().optional(),
  types: z.array(z.string()).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = Number((await params).id)
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
  const id = Number((await params).id)
  if (!(await deleteProductAttribute(id))) return NextResponse.json({ error: "Атрибут не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
