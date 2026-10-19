import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { accountBulkPaymentSchema, createAccountBulkPayment, listAccountBulkPayments, missingAccountClientIds } from "@/lib/account-bulk-payments-repo"
import { todayIso } from "@/lib/finance/dates"

// Legacy log of the old "Групповая оплата" (kept for existing rows, which the
// finance ledger still counts). The Долги по счетам page posts to
// /api/balances/group-payment instead — do not post the same payment to both.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listAccountBulkPayments()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, accountBulkPaymentSchema)
  if (parsed.error) return parsed.error

  // Duplicate ids would count the amount twice for the same client.
  const clientIds = [...new Set(parsed.data.clientIds)]
  if ((await missingAccountClientIds(clientIds)).length) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  const payment = await createAccountBulkPayment({
    clientIds,
    currency: parsed.data.currency || "sum",
    amount: parsed.data.amount,
    paymentDate: parsed.data.paymentDate || todayIso(),
    comment: parsed.data.comment ?? "",
  })
  return NextResponse.json(payment, { status: 201 })
}
