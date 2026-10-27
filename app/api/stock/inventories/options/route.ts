import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getStockInventoryOptions } from "@/lib/stock-inventories-repo"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/stock/inventories/options → {warehouses, activeWarehouses, users, currency}: every
// warehouse (the list filter), the ones a new count may use (the form's select: an inactive
// warehouse takes no new counts), the "Создал" filter and the base currency of the sums.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await getStockInventoryOptions())
}
