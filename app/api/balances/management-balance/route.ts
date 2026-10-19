import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getManagementBalanceReport, parseManagementBalanceQuery } from "@/lib/finance-management-balance"

// GET /api/balances/management-balance?beginDate&endDate[&division…][&branch] → ManagementReport
// ("Управленческий баланс по филиалам", demo stats/branch_balance/).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const parsed = parseManagementBalanceQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await getManagementBalanceReport(parsed.data))
}
