import { NextRequest } from "next/server"

import { requireRole } from "@/lib/rbac"
import { deleteIncomingExpense } from "@/lib/supplier-incomings-repo"
import { incomingChangeResponse } from "@/lib/supplier-incomings-api"

type RouteParams = { params: Promise<{ id: string; expenseId: string }> }

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const { id, expenseId } = await params
  return incomingChangeResponse(await deleteIncomingExpense(Number(id), Number(expenseId), auth.user.displayName), "")
}
