import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { cashErrorResponse, cashGroupPaymentSchema } from "@/lib/cash/api"
import { createCashGroupPayment } from "@/lib/cash/group-payment"

// POST /api/cash/group-payment  CashGroupPaymentInput → 201 { results, count, total } ("Груповой приход").
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, cashGroupPaymentSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await createCashGroupPayment(parsed.data, auth.user.displayName), { status: 201 })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
