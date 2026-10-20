import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { incomingChangeResponse, incomingNotFound, supplierIncomingSchema } from "@/lib/supplier-incomings-api"
import { changeIncomingStatus, deleteIncoming, parseIncomingInput, updateIncoming } from "@/lib/supplier-incomings-repo"
import { parseProcurementBody, parseRouteId, procurementWrite } from "@/lib/supplier-refs"

const statusSchema = z.object({ action: z.enum(["accept", "unaccept", "cancel"], { error: "Неизвестное действие" }) })

type RouteParams = { params: Promise<{ id: string }> }

/** Status changes: accept onto the warehouse, undo the acceptance (409 while the
 * warehouse no longer holds the goods), cancel. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return incomingNotFound()
  const parsed = await parseProcurementBody(request, statusSchema)
  if (parsed.error) return parsed.error

  return procurementWrite(async () =>
    incomingChangeResponse(await changeIncomingStatus(id, parsed.data.action, auth.user.displayName), "Действие недоступно для текущего статуса поставки"),
  )
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return incomingNotFound()
  const parsed = await parseProcurementBody(request, supplierIncomingSchema)
  if (parsed.error) return parsed.error

  return procurementWrite(async () =>
    incomingChangeResponse(await updateIncoming(id, parseIncomingInput(parsed.data), auth.user.displayName), "Изменять можно только поставку в ожидании"),
  )
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return incomingNotFound()
  const result = await deleteIncoming(id)
  if (result === "not_found") return incomingNotFound()
  if (result === "locked") return NextResponse.json({ error: "Принятую поставку удалить нельзя" }, { status: 409 })
  if (result === "has_payments") return NextResponse.json({ error: "По поставке есть оплаты — удалить нельзя" }, { status: 409 })
  return NextResponse.json({ ok: true })
}
