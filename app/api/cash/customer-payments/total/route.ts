import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { customerPaymentTotals, parseCustomerPaymentsQuery } from "@/lib/cash/customer-payments"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/cash/customer-payments/total?<same as the list> → CustomerPaymentTotalsResult (demo total_payment).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseCustomerPaymentsQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await customerPaymentTotals(parsed.data))
}
