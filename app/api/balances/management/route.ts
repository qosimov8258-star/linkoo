import { NextResponse } from "next/server"

import { requireCompanyMoneyReader } from "@/lib/company-money"
import { parseManagementQuery } from "@/lib/finance/api"
import { getManagementBalance } from "@/lib/finance/management"

// GET /api/balances/management?from&to[&organization…][&branch…] → ManagementBalanceResult
export async function GET(request: Request) {
  const reader = await requireCompanyMoneyReader()
  if (reader.error) return reader.error

  const parsed = parseManagementQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await getManagementBalance(parsed.data))
}
