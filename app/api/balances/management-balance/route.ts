import { NextResponse } from "next/server"

import { requireCompanyMoneyReader } from "@/lib/company-money"
import { getManagementBalanceReport, parseManagementBalanceQuery } from "@/lib/finance-management-balance"

// GET /api/balances/management-balance?beginDate&endDate[&division…][&branch] → ManagementReport
// ("Управленческий баланс по филиалам", demo stats/branch_balance/).
export async function GET(request: Request) {
  const reader = await requireCompanyMoneyReader()
  if (reader.error) return reader.error

  const parsed = parseManagementBalanceQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await getManagementBalanceReport(parsed.data))
}
