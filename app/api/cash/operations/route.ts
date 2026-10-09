import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { cashErrorResponse, cashOperationSchema, parseCashListQuery } from "@/lib/cash/api"
import { listCashOperations } from "@/lib/cash/list"
import { createCashOperation } from "@/lib/cash/write"

// GET  /api/cash/operations?… → CashListResult (the "Управления кассой" list).
// POST /api/cash/operations  CashOperationInput → 201 CashWriteResult ("Приход" / "Расход").
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseCashListQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listCashOperations(parsed.data))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, cashOperationSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await createCashOperation(parsed.data, auth.user.displayName), { status: 201 })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
