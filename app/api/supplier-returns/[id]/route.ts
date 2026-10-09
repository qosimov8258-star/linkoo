import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { changeSupplierReturnStatus, deleteSupplierReturn, parseSupplierReturnInput, updateSupplierReturn } from "@/lib/supplier-returns-repo"

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

  const supplierReturn = await updateSupplierReturn(id, input)
  if (supplierReturn === "not_found") return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
  if (supplierReturn === "locked") return NextResponse.json({ error: "Изменять можно только возврат в процессе" }, { status: 409 })
  return NextResponse.json(supplierReturn)
}

const statusSchema = z.object({ action: z.enum(["give", "cancel"]) })

/** "Передать" / "Отменить". */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, statusSchema)
  if (parsed.error) return parsed.error

  const result = await changeSupplierReturnStatus(id, parsed.data.action, auth.user.displayName)
  if (result === "not_found") return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
  if (result === "locked") return NextResponse.json({ error: "Действие недоступно для текущего статуса возврата" }, { status: 409 })
  return NextResponse.json(result)
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const result = await deleteSupplierReturn(id)
  if (result === "not_found") return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
  if (result === "locked") return NextResponse.json({ error: "Переданный возврат удалить нельзя — сначала отмените его" }, { status: 409 })
  return NextResponse.json({ ok: true })
}
