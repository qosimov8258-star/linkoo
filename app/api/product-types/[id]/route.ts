import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteProductType, updateProductType } from "@/lib/product-types-repo"

const productTypeSchema = z.object({
  name: z.string().trim().min(1),
  organization: z.string().trim().min(1),
  parentId: z.number().finite().nullable().optional(),
  showInBot: z.boolean().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, productTypeSchema)
  if (parsed.error) return parsed.error

  const type = (await updateProductType(id, {
    name: parsed.data.name,
    organization: parsed.data.organization,
    parentId: parsed.data.parentId ?? null,
    showInBot: parsed.data.showInBot ?? false,
  }))
  if (!type) return NextResponse.json({ error: "Тип продукта не найден" }, { status: 404 })
  return NextResponse.json(type)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteProductType(id))
  if (!ok) return NextResponse.json({ error: "Тип продукта не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
