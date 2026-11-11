import { NextResponse } from "next/server"

import { requireCompanyMoneyReader } from "@/lib/company-money"
import { parseCashListQuery } from "@/lib/cash/api"
import { cashOperationTotals } from "@/lib/cash/list"

// GET /api/cash/operations/total?<list params> → CashTotalsResult (per currency
// income / outcome / total + cash/bank split; deleted and unverified excluded).
export async function GET(request: Request) {
  const reader = await requireCompanyMoneyReader()
  if (reader.error) return reader.error
  const parsed = parseCashListQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await cashOperationTotals(parsed.data))
}
