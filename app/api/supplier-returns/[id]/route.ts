import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { stockDateRefusal } from "@/lib/client-returns-api"
import { todayIso } from "@/lib/finance/dates"
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
    // Linko edits a return of any status; only one from its old base is never changed.
    if (supplierReturn === "locked") return NextResponse.json({ error: "Со старой базы нельзя изменять" }, { status: 409 })
    return NextResponse.json(supplierReturn)
  })
}

const statusSchema = z.object({
  action: z.enum(["give", "cancel"], { error: "Неизвестное действие" }),
  /** «Принять» → «Дата» (YYYY-MM-DD): only with Linko's can_manage_stock_date (an administrator here), never after today. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Неверная дата" }).optional(),
})

/** «Принять» = give (409 while the warehouse does not hold the goods) / «Отменить» = cancel. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return notFound()
  const parsed = await parseProcurementBody(request, statusSchema)
  if (parsed.error) return parsed.error

  const date = parsed.data.action === "give" ? parsed.data.date : undefined
  if (date && date > todayIso()) return NextResponse.json({ error: "Неверная дата", field: "date" }, { status: 400 })
  const refusal = stockDateRefusal(auth.user, date)
  if (refusal) return refusal

  return procurementWrite(async () => {
    const result = await changeSupplierReturnStatus(id, parsed.data.action, auth.user.displayName, date)
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
