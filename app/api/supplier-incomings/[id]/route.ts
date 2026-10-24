import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { incomingChangeResponse, supplierIncomingSchema } from "@/lib/supplier-incomings-api"
import { changeIncomingStatus, deleteIncoming, parseIncomingInput, updateIncoming } from "@/lib/supplier-incomings-repo"

const statusSchema = z.object({ action: z.enum(["accept", "unaccept", "cancel"]), date: z.string().optional() })

type RouteParams = { params: Promise<{ id: string }> }

/** Status changes: accept onto the warehouse, undo the acceptance, cancel. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, statusSchema)
  if (parsed.error) return parsed.error

  const result = await changeIncomingStatus(id, parsed.data.action, auth.user.displayName, parsed.data.date)
  return incomingChangeResponse(result, "Действие недоступно для текущего статуса поставки")
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, supplierIncomingSchema)
  if (parsed.error) return parsed.error

  const input = parseIncomingInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Поставщик, склад и товары обязательны" }, { status: 400 })

  return incomingChangeResponse(await updateIncoming(id, input, auth.user.displayName), "Изменять можно только поставку в ожидании")
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const result = await deleteIncoming(id)
  if (result === "not_found") return NextResponse.json({ error: "Приемка не найдена" }, { status: 404 })
  if (result === "locked") return NextResponse.json({ error: "Принятую поставку удалить нельзя" }, { status: 409 })
  return NextResponse.json({ ok: true })
}
