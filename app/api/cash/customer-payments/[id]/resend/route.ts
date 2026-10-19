import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { cashErrorResponse } from "@/lib/cash/api"
import { resendCustomerPayment } from "@/lib/cash/customer-payments"

// POST /api/cash/customer-payments/[id]/resend → { id, clientConfirmation: "requested", resends }
// ("Переотправить запрос", demo telegram/resend_client_transaction). No Telegram bot is configured:
// the request is only recorded (customer_payment_resends + server log).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Оплата не найдена", field: null }, { status: 404 })
  try {
    return NextResponse.json(await resendCustomerPayment(id, auth.user.displayName))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
