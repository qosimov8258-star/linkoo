import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { cashErrorResponse } from "@/lib/cash/api"
import { deleteCustomerPayment, updateCustomerPayment } from "@/lib/customer-payments-repo"

// Legacy endpoints of customer_payments. PATCH changes only the comment —
// accepting into a cashbox goes through POST /api/cash/accept-cash and full
// edits through PUT /api/cash/customer-payments/[id]. DELETE is soft.
type RouteParams = { params: Promise<{ id: string }> }

const paymentPatchSchema = z
  .object({
    accepted: z.boolean().optional(),
    acceptedAt: z.string().optional(),
    kassa: z.string().optional(),
    comment: z.string().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Нет данных для обновления" })

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, paymentPatchSchema)
  if (parsed.error) return parsed.error
  if (parsed.data.accepted !== undefined || parsed.data.acceptedAt !== undefined || parsed.data.kassa !== undefined) {
    return NextResponse.json({ error: "Принять на кассу: POST /api/cash/accept-cash", field: "cashbox" }, { status: 409 })
  }

  const payment = await updateCustomerPayment(id, { comment: parsed.data.comment })
  if (!payment) return NextResponse.json({ error: "Оплата не найдена" }, { status: 404 })
  return NextResponse.json(payment)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  try {
    const ok = await deleteCustomerPayment(id, auth.user.displayName)
    if (!ok) return NextResponse.json({ error: "Оплата не найдена" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
