import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"
import { priceGridSaveSchema } from "@/lib/price-lists-api"
import { PriceGridError, parsePriceGridQuery, priceGrid, savePriceGrid } from "@/lib/price-lists-grid"

// GET /api/price-lists/prices?priceList=1&priceList=2&search&type&brand&kind&page&pageSize[&cost=1]
// — the "Установить цену в прайс-лист" grid: {count, results: [{kind, id, key, name, …, prices:
// {[priceListId]: {cash, nonCash, min, max, currency, nonCashCurrency}}}], priceLists, types, brands}.
// pageSize=0 returns every matching row (Excel template, markup); cost=1 adds the average cost.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await priceGrid(parsePriceGridQuery(request.url)))
}

// POST /api/price-lists/prices — demo POST sales/price_list_item/add_items_separately/:
// {rows: [{kind, id, prices: [{priceListId, cash?, nonCash?, min?, max?}]}], cashCurrency, nonCashCurrency?}.
// Empty values keep the stored ones; everything is written in one transaction.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, priceGridSaveSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await savePriceGrid(parsed.data))
  } catch (error) {
    if (error instanceof PriceGridError || error instanceof RangeError) return NextResponse.json({ error: error.message }, { status: error instanceof PriceGridError ? error.status : 400 })
    throw error
  }
}
