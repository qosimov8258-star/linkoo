import { NextRequest, NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { deleteIncomingExpense } from "@/lib/supplier-incomings-repo"
import { incomingChangeResponse, incomingNotFound } from "@/lib/supplier-incomings-api"
import { parseRouteId } from "@/lib/supplier-refs"

type RouteParams = { params: Promise<{ id: string; expenseId: string }> }

/** Deletes an additional expense of a supply; 409 while a live cash entry pays it. */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const { id, expenseId } = await params
  const incomingId = parseRouteId(id)
  const lineId = parseRouteId(expenseId)
  if (!incomingId || !lineId) return incomingNotFound()
  const result = await deleteIncomingExpense(incomingId, lineId, auth.user.displayName)
  if (result === "has_payments") return NextResponse.json({ error: "По расходу есть оплаты — удалить нельзя" }, { status: 409 })
  return incomingChangeResponse(result, "")
}
