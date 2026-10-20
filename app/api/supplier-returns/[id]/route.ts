import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import {
  changeSupplierReturnStatus,
  deleteSupplierReturn,
  parseSupplierReturnInput,
  supplierReturnSchema,
  updateSupplierReturn,
} from "@/lib/supplier-returns-repo"
import { parseProcurementBody, parseRouteId, procurementWrite } from "@/lib/supplier-refs"

type RouteParams = { params: Promise<{ id: string }> }

const notFound = () => NextResponse.json({ error: "Возврат не найден" }, { status: 404 })

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return notFound()
  const parsed = await parseProcurementBody(request, supplierReturnSchema)
  if (parsed.error) return parsed.error

  return procurementWrite(async () => {
    const supplierReturn = await updateSupplierReturn(id, parseSupplierReturnInput(parsed.data))
    if (supplierReturn === "not_found") return notFound()
    if (supplierReturn === "locked") return NextResponse.json({ error: "Изменять можно только возврат в процессе" }, { status: 409 })
    return NextResponse.json(supplierReturn)
  })
}

const statusSchema = z.object({ action: z.enum(["give", "cancel"], { error: "Неизвестное действие" }) })

/** "Передать" (409 while the warehouse does not hold the goods) / "Отменить". */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return notFound()
  const parsed = await parseProcurementBody(request, statusSchema)
  if (parsed.error) return parsed.error

  return procurementWrite(async () => {
    const result = await changeSupplierReturnStatus(id, parsed.data.action, auth.user.displayName)
    if (result === "not_found") return notFound()
    if (result === "locked") return NextResponse.json({ error: "Действие недоступно для текущего статуса возврата" }, { status: 409 })
    return NextResponse.json(result)
  })
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return notFound()
  const result = await deleteSupplierReturn(id)
  if (result === "not_found") return notFound()
  if (result === "locked") return NextResponse.json({ error: "Переданный возврат удалить нельзя — сначала отмените его" }, { status: 409 })
  return NextResponse.json({ ok: true })
}
