import { NextRequest, NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { deleteSupplier, parseSupplierInput, supplierSchema, updateSupplier } from "@/lib/suppliers-repo"
import { parseProcurementBody, parseRouteId, procurementWrite } from "@/lib/supplier-refs"

type RouteParams = { params: Promise<{ id: string }> }

const notFound = () => NextResponse.json({ error: "Поставщик не найден" }, { status: 404 })

/** Edit; a rename is carried over to every document that stores the supplier name. */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return notFound()
  const parsed = await parseProcurementBody(request, supplierSchema)
  if (parsed.error) return parsed.error

  const input = parseSupplierInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Название, категория и адрес обязательны" }, { status: 400 })

  return procurementWrite(async () => {
    const supplier = await updateSupplier(id, input)
    return supplier ? NextResponse.json(supplier) : notFound()
  })
}

/** 409 "Удаление невозможно из-за связи с другими данными" (+ usage) while documents reference the supplier. */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return notFound()
  return procurementWrite(async () => ((await deleteSupplier(id)) ? NextResponse.json({ ok: true }) : notFound()))
}
