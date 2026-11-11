import { NextResponse } from "next/server"

import { requirePurchaseReader } from "@/lib/company-money"
import { STOCK_CHECK_NET_COST } from "@/lib/stock/level-types"

// GET /api/stock/balances/check-net-cost → {text, text_color} ("Проверить себестоимость",
// demo stock/check_net_cost/: the check is disabled in the system settings).
export async function GET() {
  const reader = await requirePurchaseReader()
  if (reader.error) return reader.error
  return NextResponse.json(STOCK_CHECK_NET_COST)
}
