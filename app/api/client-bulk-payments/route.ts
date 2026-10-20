import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { cashErrorResponse } from "@/lib/cash/api"
import { clientBulkPaymentSchema, createClientBulkPayment, listClientBulkPayments, missingClientIds } from "@/lib/client-bulk-payments-repo"

// Legacy group payments of Баланс клиентов. The page posts to
// /api/balances/group-payment. GET lists the stored legacy rows (not cancelled);
// POST { clientIds, cashboxId, amount, currency?, paymentDate?, … } goes through
// the cash core (one customer payment per client, received into the cashbox) →
// 201 { results, count, total }. DELETE /api/client-bulk-payments/[id] cancels a stored row.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await listClientBulkPayments())
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, clientBulkPaymentSchema)
  if (parsed.error) return parsed.error

  const clientIds = [...new Set(parsed.data.clientIds)]
  if ((await missingClientIds(clientIds)).length) return NextResponse.json({ error: "Клиент не найден", field: "client" }, { status: 404 })
  try {
    return NextResponse.json(await createClientBulkPayment({ ...parsed.data, clientIds }, auth.user.displayName), { status: 201 })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
