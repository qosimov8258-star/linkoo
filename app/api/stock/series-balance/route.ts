import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listSeriesBalance } from "@/lib/order-series-repo"

// GET /api/stock/series-balance?product=<id>&warehouse=<name>&search=&pageSize=50 — the series of a product that hold
// something in the warehouse, with their balance (Linko's stock/series_balance/?product=&stock=; «Доступно» of the
// order's «Изменит серии»): {count, results: [{id, productId, number, expirationDate, displayName, totalBalance,
// available}]}, the latest expiry first. The balances are estimated (lib/order-series-balance.ts).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const search = new URL(request.url).searchParams
  const product = search.get("product") ?? ""
  if (!/^\d{1,10}$/.test(product)) return NextResponse.json({ error: "Неверный идентификатор", field: "product" }, { status: 400 })
  const size = Number(search.get("pageSize") ?? 50)
  return NextResponse.json(
    await listSeriesBalance({
      productId: Number(product),
      warehouse: (search.get("warehouse") ?? "").slice(0, 200),
      search: (search.get("search") ?? "").slice(0, 100),
      limit: Number.isFinite(size) ? size : 50,
    }),
  )
}
