import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { cashErrorResponse } from "@/lib/cash/api"
import { customerPaymentEditSchema, deleteCustomerPayment, getCustomerPayment, updateCustomerPayment } from "@/lib/cash/customer-payments"
import { isDbId } from "@/lib/cash/common"

// GET    /api/cash/customer-payments/[id] → CustomerPaymentRow (deleted rows too).
// PUT    /api/cash/customer-payments/[id] CustomerPaymentEditInput → CustomerPaymentRow ("Изменение транзакции").
// DELETE /api/cash/customer-payments/[id] → { id, deleted } (soft; demo client_transaction/<id>/cancel/).
type RouteParams = { params: Promise<{ id: string }> }

async function idOf(params: RouteParams["params"]): Promise<number | null> {
  const id = (parseIdSegment((await params).id) ?? 0)
  return isDbId(id) ? id : null
}

const notFound = () => NextResponse.json({ error: "Оплата не найдена", field: null }, { status: 404 })

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = await idOf(params)
  const row = id ? await getCustomerPayment(id) : null
  return row ? NextResponse.json(row) : notFound()
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await idOf(params)
  if (!id) return notFound()
  const parsed = await parseJsonBody(request, customerPaymentEditSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await updateCustomerPayment(id, parsed.data, auth.user.displayName))
  } catch (error) {
    return cashErrorResponse(error)
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await idOf(params)
  if (!id) return notFound()
  try {
    return NextResponse.json(await deleteCustomerPayment(id, auth.user.displayName))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
