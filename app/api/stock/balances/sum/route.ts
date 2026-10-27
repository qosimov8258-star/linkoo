import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getStockLevelSum } from "@/lib/stock/level"
import { parseStockLevelQuery } from "@/lib/stock/level-api"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/stock/balances/sum?(same filters as the list) → StockLevelSum
// {total, reserved, defected, available: {count, price}, given, currency} (demo stats/stock/balances_sum/).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseStockLevelQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await getStockLevelSum(parsed.data))
}
