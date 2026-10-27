import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseIdSegment, parseJsonBody } from "@/lib/validation"
import { cashErrorResponse, moneyRequestUpdateSchema } from "@/lib/cash/api"
import { getMoneyRequest, updateMoneyRequest } from "@/lib/cash/money-requests"
import { isDbId } from "@/lib/cash/common"

type Params = { params: Promise<{ id: string }> }

function parseId(value: string): number | null {
  const id = parseIdSegment(value) ?? 0
  return isDbId(id) ? id : null
}

// GET   /api/cash/money-requests/[id] → MoneyRequest (with logs).
// PATCH /api/cash/money-requests/[id]  { status: "approved" | "cancelled", amount?, currency?, comment? } → MoneyRequest.
export async function GET(_request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = parseId((await params).id)
  const request = id ? await getMoneyRequest(id) : null
  if (!request) return NextResponse.json({ error: "Запрос не найден" }, { status: 404 })
  return NextResponse.json(request)
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseId((await params).id)
  if (!id) return NextResponse.json({ error: "Запрос не найден" }, { status: 404 })
  const parsed = await parseJsonBody(request, moneyRequestUpdateSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await updateMoneyRequest(id, parsed.data, auth.user.displayName))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
