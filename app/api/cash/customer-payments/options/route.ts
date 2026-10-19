import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { customerPaymentOptions } from "@/lib/cash/customer-payments"

// GET /api/cash/customer-payments/options → CustomerPaymentOptions (filter / dialog lookups of
// "Оплаты от клиентов" and "Ожидаемые оплаты").
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await customerPaymentOptions())
}
