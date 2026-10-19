import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getStockLevelList } from "@/lib/stock/level"
import { parseStockLevelQuery } from "@/lib/stock/level-api"

// GET /api/stock/balances?mode=amount|net_cost|price&unit=amount|box|capacity|weight&priceList&search
//   &warehouse*&branch*&type*&subcategory*&brand*&supplier*&organization*&onlyHas=1&ordering&page&pageSize(0 = all)
// → StockLevelList {count, page, pageSize, baseCurrency, currency, rows, sum} ("Остаток", demo stock/all_balances/).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseStockLevelQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await getStockLevelList(parsed.data))
}
