import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { cashErrorResponse, cashOperationSchema } from "@/lib/cash/api"
import { getCashOperation, getOperationDetails } from "@/lib/cash/list"
import { deleteCashOperation, getOperationInput, updateCashOperation } from "@/lib/cash/write"

type Params = { params: Promise<{ key: string }> }

// GET    /api/cash/operations/[key] → { operation, input, children, staff }  (key = cash-12 | customer-5 | supplier-3 | acceptance-2)
// PUT    /api/cash/operations/[key]  CashOperationInput → CashWriteResult (edit; the key may change when the owner table changes)
// DELETE /api/cash/operations/[key] → { key, deleted: [keys] } (soft delete)
export async function GET(_request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const { key } = await params
  const operation = await getCashOperation(key)
  if (!operation) return NextResponse.json({ error: "Операция не найдена" }, { status: 404 })
  const [input, details] = await Promise.all([getOperationInput(key), getOperationDetails(key)])
  return NextResponse.json({ operation, input, ...details })
}

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, cashOperationSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await updateCashOperation((await params).key, parsed.data, auth.user.displayName))
  } catch (error) {
    return cashErrorResponse(error)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  try {
    return NextResponse.json(await deleteCashOperation((await params).key, auth.user.displayName))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
