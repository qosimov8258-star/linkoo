import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { STOCK_CHECK_NET_COST } from "@/lib/stock/level-types"

// GET /api/stock/balances/check-net-cost → {text, text_color} ("Проверить себестоимость",
// demo stock/check_net_cost/: the check is disabled in the system settings).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(STOCK_CHECK_NET_COST)
}
