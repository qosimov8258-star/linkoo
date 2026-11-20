import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { withDbErrors } from "@/lib/db-errors"
import { listInventoryProductOptions } from "@/lib/stock-inventories-products"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/stock/inventories/products?search=&pageSize=50 → {count, results: StockInventoryProductOption[]}: the
// «Наименование» options of the inventory edit form's add row (Linko's stock/all_balances/?search&page_size=50).
export const GET = withDbErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const search = new URL(request.url).searchParams
  const size = Number(search.get("pageSize") ?? search.get("page_size") ?? 50)
  return NextResponse.json(await listInventoryProductOptions({ search: (search.get("search") ?? "").trim().slice(0, 200), limit: Number.isFinite(size) ? size : 50 }))
})
