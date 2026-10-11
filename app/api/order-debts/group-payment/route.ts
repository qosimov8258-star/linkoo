import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { orderDebtErrorResponse, orderGroupPaymentSchema, payOrdersGroup } from "@/lib/finance-order-debts"

// POST /api/order-debts/group-payment { cashboxId, date?, branch?, categoryId?, responsibleId?, isVerified?, comment?,
// items: [{ orderId, amount, currency, comment? }] } ("Групповая оплата") → 201 { results, failed }.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, orderGroupPaymentSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await payOrdersGroup(parsed.data, auth.user.displayName), { status: 201 })
  } catch (error) {
    return orderDebtErrorResponse(error)
  }
}
