import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getStockOptions } from "@/lib/stock/options"

// GET /api/stock/options → filter options of the stock pages:
// {warehouses:[{name,branch}], types, subcategories, brands, suppliers,
//  organizations, branches, priceLists, priceListCurrency:{name: currency}}
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await getStockOptions())
}
