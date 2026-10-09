import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { clientBulkPaymentSchema, createClientBulkPayment, listClientBulkPayments, missingClientIds } from "@/lib/client-bulk-payments-repo"

// Legacy group payments of Баланс клиентов (kept for stored rows and old
// clients). The page itself now posts to /api/balances/group-payment.
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
  if ((await missingClientIds(clientIds)).length) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  const payment = await createClientBulkPayment({
    clientIds,
    currency: parsed.data.currency || "sum",
    amount: parsed.data.amount,
    paymentDate: parsed.data.paymentDate || new Date().toISOString().slice(0, 10),
    comment: parsed.data.comment ?? "",
  })
  return NextResponse.json(payment, { status: 201 })
}
