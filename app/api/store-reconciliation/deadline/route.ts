import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deadlineSchema, FinanceInputError, setPaymentDeadline } from "@/lib/finance-store-reconciliation-writes"

// POST /api/store-reconciliation/deadline {variant?, key | clientId, paymentDeadline: "YYYY-MM-DD" | "" | null}
// — "Изменить срок долга" (demo market/market/set_payment_deadline {market | client}).
// Appends a history row; the latest one is the client's / account's debt term.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, deadlineSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await setPaymentDeadline(parsed.data, auth.user.displayName), { status: 201 })
  } catch (error) {
    if (error instanceof FinanceInputError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
