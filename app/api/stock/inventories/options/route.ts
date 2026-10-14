import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getStockInventoryOptions } from "@/lib/stock-inventories-repo"

// GET /api/stock/inventories/options → {warehouses, users, currency}: the warehouse select,
// the "Создал" filter and the base currency of the sums.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await getStockInventoryOptions())
}
