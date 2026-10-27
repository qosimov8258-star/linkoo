import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { customerPaymentOptions } from "@/lib/cash/customer-payments"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/cash/customer-payments/options → CustomerPaymentOptions (filter / dialog lookups of
// "Оплаты от клиентов" and "Ожидаемые оплаты").
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await customerPaymentOptions())
}
