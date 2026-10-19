import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { PRICE_LIST_CALC_METHODS } from "@/components/analytics/price-lists-data"

// GET /api/price-lists/calc-methods — demo GET sales/price_list/calc_method/: [{id, name, keys}].
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(PRICE_LIST_CALC_METHODS)
}
