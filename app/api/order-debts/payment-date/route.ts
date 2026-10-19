import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { orderDebtErrorResponse, orderPaymentDateSchema, updateOrderPaymentDates } from "@/lib/finance-order-debts"

// POST /api/order-debts/payment-date { orderIds, paymentDate } ("Изменение даты оплаты") → { updated }.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, orderPaymentDateSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await updateOrderPaymentDates(parsed.data.orderIds, parsed.data.paymentDate))
  } catch (error) {
    return orderDebtErrorResponse(error)
  }
}
