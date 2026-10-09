import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { groupPaymentSchema } from "@/lib/finance/api"
import { createGroupPayment, FinanceInputError } from "@/lib/finance/group-payment"

// POST /api/balances/group-payment — "Групповой приход" of Баланс клиентов and
// Долги по счетам: one customer payment per item, in the cashbox currency.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, groupPaymentSchema)
  if (parsed.error) return parsed.error

  try {
    const result = await createGroupPayment(parsed.data, auth.user.displayName)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof FinanceInputError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
