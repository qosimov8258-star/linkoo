import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseCashListQuery } from "@/lib/cash/api"
import { cashOperationTotals } from "@/lib/cash/list"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/cash/operations/total?<list params> → CashTotalsResult (per currency
// income / outcome / total + cash/bank split; deleted and unverified excluded).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseCashListQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await cashOperationTotals(parsed.data))
}
