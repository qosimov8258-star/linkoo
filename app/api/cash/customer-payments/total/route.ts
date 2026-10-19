import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { customerPaymentTotals, parseCustomerPaymentsQuery } from "@/lib/cash/customer-payments"

// GET /api/cash/customer-payments/total?<same as the list> → CustomerPaymentTotalsResult (demo total_payment).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseCustomerPaymentsQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await customerPaymentTotals(parsed.data))
}
