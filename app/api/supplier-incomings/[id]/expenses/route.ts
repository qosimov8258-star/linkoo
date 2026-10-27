import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { addIncomingExpense, listIncomingExpenses } from "@/lib/supplier-incomings-repo"
import { incomingChangeResponse, incomingExpenseSchema, incomingNotFound } from "@/lib/supplier-incomings-api"
import { parseProcurementBody, parseRouteId, procurementWrite } from "@/lib/supplier-refs"
import { notSignedInResponse } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!(await getCurrentUser())) return notSignedInResponse()
  const id = parseRouteId((await params).id)
  const expenses = id ? await listIncomingExpenses(id) : null
  return expenses ? NextResponse.json(expenses) : incomingNotFound()
}

/** "Добавить расход": amount 0 < x ≤ 1e13, a configured currency with a rate, a parseable date. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseRouteId((await params).id)
  if (!id) return incomingNotFound()
  const parsed = await parseProcurementBody(request, incomingExpenseSchema)
  if (parsed.error) return parsed.error
  return procurementWrite(async () =>
    incomingChangeResponse(await addIncomingExpense(id, parsed.data, auth.user.displayName), "Нельзя добавить расход к отмененной поставке"),
  )
}
