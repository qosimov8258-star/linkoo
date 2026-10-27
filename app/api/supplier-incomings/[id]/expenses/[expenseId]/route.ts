import { NextRequest } from "next/server"

import { requireRole } from "@/lib/rbac"
import { deleteIncomingExpense } from "@/lib/supplier-incomings-repo"
import { incomingChangeResponse, incomingNotFound } from "@/lib/supplier-incomings-api"
import { parseRouteId } from "@/lib/supplier-refs"

type RouteParams = { params: Promise<{ id: string; expenseId: string }> }

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const { id, expenseId } = await params
  const incomingId = parseRouteId(id)
  const lineId = parseRouteId(expenseId)
  if (!incomingId || !lineId) return incomingNotFound()
  return incomingChangeResponse(await deleteIncomingExpense(incomingId, lineId, auth.user.displayName), "")
}
