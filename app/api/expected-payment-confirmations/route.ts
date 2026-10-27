import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { listExpectedPaymentConfirmations } from "@/lib/expected-payment-confirmations-repo"
import { notSignedInResponse } from "@/lib/validation"

// Legacy, read-only. Paying an order ("Ожидаемые оплаты") is
// POST /api/cash/orders/[id]/pay — this table never reached any balance.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await listExpectedPaymentConfirmations())
}

export async function POST() {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  return NextResponse.json({ error: "Оплата заказа: POST /api/cash/orders/[id]/pay", field: null }, { status: 410 })
}
