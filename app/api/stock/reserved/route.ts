import { NextResponse } from "next/server"

import { withDbErrors } from "@/lib/db-errors"
import { getCurrentUser } from "@/lib/current-user"
import { getStockReservedDocs } from "@/lib/stock/reserved"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/stock/reserved?key=product:166&warehouse* → {rows: StockReservedDoc[]}: the order and transfer lines that
// reserve the item (Остаток «Забронировано», Linko stock/reserved_product/?product=<id>&stock=).
export const GET = withDbErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const params = new URL(request.url).searchParams
  const key = (params.get("key") ?? "").trim()
  if (!/^(product|raw_material):\d+$|^name:.{1,300}$/.test(key)) return NextResponse.json({ error: "Товар не найден" }, { status: 404 })
  const warehouses = params.getAll("warehouse").map((name) => name.trim().slice(0, 300)).filter(Boolean).slice(0, 500)
  return NextResponse.json({ rows: await getStockReservedDocs(key, warehouses) })
})
