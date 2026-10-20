import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { cashErrorResponse } from "@/lib/cash/api"
import { accountBulkPaymentSchema, createAccountBulkPayment, listAccountBulkPayments, missingAccountClientIds } from "@/lib/account-bulk-payments-repo"

// Legacy log of the old "Групповая оплата" of Долги по счетам. The page posts to
// /api/balances/group-payment. GET lists the stored legacy rows (not cancelled);
// POST { clientIds, cashboxId, amount, currency?, paymentDate?, … } goes through
// the cash core (one customer payment per client, received into the cashbox) →
// 201 { results, count, total }. DELETE /api/account-bulk-payments/[id] cancels a stored row.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await listAccountBulkPayments())
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, accountBulkPaymentSchema)
  if (parsed.error) return parsed.error

  // Duplicate ids would count the amount twice for the same client.
  const clientIds = [...new Set(parsed.data.clientIds)]
  if ((await missingAccountClientIds(clientIds)).length) return NextResponse.json({ error: "Клиент не найден", field: "client" }, { status: 404 })
  try {
    return NextResponse.json(await createAccountBulkPayment({ ...parsed.data, clientIds }, auth.user.displayName), { status: 201 })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
