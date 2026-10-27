import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { cashErrorResponse } from "@/lib/cash/api"
import { resendCustomerPayment } from "@/lib/cash/customer-payments"
import { isDbId } from "@/lib/cash/common"
import { parseIdSegment } from "@/lib/validation"

// POST /api/cash/customer-payments/[id]/resend → { id, clientConfirmation: "requested", resends }
// ("Переотправить запрос", demo telegram/resend_client_transaction). No Telegram bot is configured:
// the request is only recorded (customer_payment_resends + server log).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = (parseIdSegment((await params).id) ?? 0)
  if (!isDbId(id)) return NextResponse.json({ error: "Оплата не найдена", field: null }, { status: 404 })
  try {
    return NextResponse.json(await resendCustomerPayment(id, auth.user.displayName))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
