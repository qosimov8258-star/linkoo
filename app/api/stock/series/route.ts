import { NextResponse } from "next/server"

import { listStockSeries } from "@/lib/client-returns-series-repo"
import { getCurrentUser } from "@/lib/current-user"

// GET /api/stock/series?product=<id>&search=&pageSize=50 — a product's series, newest first (Linko's stock/series/):
// {count, results: [{id, productId, number, expirationDate, isAutoCreated, displayName}]}. Linko also filters by the
// return's warehouse (&stock=); series are not kept per warehouse here, so `warehouse` is accepted and not applied
// (Linko answered every series of the product for each warehouse that was checked).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const search = new URL(request.url).searchParams
  const product = search.get("product") ?? ""
  if (!/^\d{1,10}$/.test(product)) return NextResponse.json({ error: "Неверный идентификатор", field: "product" }, { status: 400 })
  const size = Number(search.get("pageSize") ?? 50)
  return NextResponse.json(
    await listStockSeries({ productId: Number(product), search: (search.get("search") ?? "").slice(0, 100), limit: Number.isFinite(size) ? size : 50 }),
  )
}
