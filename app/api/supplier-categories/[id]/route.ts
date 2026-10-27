import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { deleteSupplierCategory, parseSupplierCategoryInput, updateSupplierCategory } from "@/lib/supplier-categories-repo"
import { parseProcurementBody, parseRouteId, procurementWrite } from "@/lib/supplier-refs"

const supplierCategorySchema = z.object({
  name: z.string({ error: "Наименование обязательно" }).trim().min(1, "Наименование обязательно").max(255, "Не более 255 символов"),
})

type RouteParams = { params: Promise<{ id: string }> }

const notFound = () => NextResponse.json({ error: "Категория не найдена" }, { status: 404 })

/** Rename; suppliers on the old name follow it (`renamedSuppliers`). */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return notFound()
  const parsed = await parseProcurementBody(request, supplierCategorySchema)
  if (parsed.error) return parsed.error

  const input = parseSupplierCategoryInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  return procurementWrite(async () => {
    const category = await updateSupplierCategory(id, input)
    return category ? NextResponse.json(category) : notFound()
  })
}

/** 409 "Удаление невозможно из-за связи с другими данными" (+ usage) while suppliers use it. */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return notFound()
  return procurementWrite(async () => ((await deleteSupplierCategory(id)) ? NextResponse.json({ ok: true }) : notFound()))
}
