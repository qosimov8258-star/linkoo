import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { priceListsByIds } from "@/lib/price-lists-repo"
import { repricingPickRows } from "@/lib/repricings-items"
import { getDb } from "@/lib/db"

// GET /api/repricings/products?priceList=<id>[&search] — the product picker of the create dialog
// (demo REMAINDER_LIST + PRODUCT_ITEM_PRICE): every item with "Доступно" and its current price in
// the list: [{kind, id, key, name, article, barcode, unit, available, price, currency}].
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const params = new URL(request.url).searchParams
  const id = Number(params.get("priceList"))
  const [list] = Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? await priceListsByIds(getDb(), [id]) : []
  if (!list) return NextResponse.json({ error: "Прайс-лист не найден" }, { status: 404 })
  return NextResponse.json(await repricingPickRows(list, (params.get("search") ?? "").slice(0, 200)))
}
