import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getStockOptions } from "@/lib/stock/options"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/stock/options → filter options of the stock pages:
// {warehouses:[{name,branch}], types, subcategories, brands, suppliers,
//  organizations, branches, priceLists, priceListCurrency:{name: currency}}
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await getStockOptions())
}
