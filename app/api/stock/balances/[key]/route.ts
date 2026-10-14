import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getStockItemDetail } from "@/lib/stock/level"
import { parseStockLevelQuery } from "@/lib/stock/level-api"

type RouteParams = { params: Promise<{ key: string }> }

// GET /api/stock/balances/<item key, e.g. product:12>?warehouse*&branch* → StockItemDetail
// (per-warehouse breakdown + latest receipts; demo stock/balances_by_product/<id>/).
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const key = decodeURIComponent((await params).key).trim()
  if (!/^(product|raw_material):\d+$|^name:.+$/.test(key)) return NextResponse.json({ error: "Товар не найден" }, { status: 404 })
  const parsed = parseStockLevelQuery(request.url)
  if (parsed.error) return parsed.error
  const detail = await getStockItemDetail(key, parsed.data)
  if (!detail) return NextResponse.json({ error: "Товар не найден" }, { status: 404 })
  return NextResponse.json(detail)
}
