import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getStockInventoryOptions } from "@/lib/stock-inventories-repo"
import { linkedWarehouseNames } from "@/lib/user-warehouses"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/stock/inventories/options → {warehouses, activeWarehouses, users, currency}: the list
// filter's warehouses (the user's «Связанные склады» as Linko, else every warehouse), the ones a
// new count may use (the form's select: an inactive warehouse takes no new counts), the "Создал"
// filter and the base currency of the sums.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await getStockInventoryOptions(await linkedWarehouseNames(user)))
}
