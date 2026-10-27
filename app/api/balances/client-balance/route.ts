import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getClientBalanceList, parseClientBalanceQuery } from "@/lib/finance-client-balance"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/balances/client-balance — "Баланс клиентов": the shared client
// ledger list (same params as /api/balances/client) plus the page's extra
// demo filters (deliveryMan, lastVisit, reject/visit days,
// onlyInvoicePayments, clientType "-" = without type) → BalanceListResult.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const parsed = parseClientBalanceQuery(request.url)
  if (parsed.error) return parsed.error

  return NextResponse.json(await getClientBalanceList(parsed.data))
}
