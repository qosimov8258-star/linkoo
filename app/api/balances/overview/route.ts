import { NextResponse } from "next/server"

import { requireCompanyMoneyReader } from "@/lib/company-money"
import { parseManagementQuery } from "@/lib/finance/api"
import { getBalanceOverview } from "@/lib/finance/overview"

// GET /api/balances/overview?from&to[&organization…] → BalanceOverview, the
// data of the dashboard tab "БАЛАНС" (management balance totals, cashboxes,
// warehouses, client / supplier debts, sales and expenses of the period).
export async function GET(request: Request) {
  const reader = await requireCompanyMoneyReader()
  if (reader.error) return reader.error
  const parsed = parseManagementQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await getBalanceOverview({ from: parsed.data.from, to: parsed.data.to, organizations: parsed.data.organizations }))
}
