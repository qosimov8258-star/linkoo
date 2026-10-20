import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parsePnlQuery } from "@/lib/finance/api"
import { getPnl } from "@/lib/finance/pnl"

// GET /api/balances/pnl — P&L of two periods (released orders by realization
// day, accepted client returns, cost of goods from lib/stock/costs.ts), in the
// base currency, with totals per branch / agent / product type / brand / zone / product.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parsePnlQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await getPnl(parsed.data))
}
