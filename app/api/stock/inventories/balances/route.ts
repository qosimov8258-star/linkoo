import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { todayIso } from "@/lib/finance/dates"
import { parseBalancesQuery } from "@/lib/stock-inventories-api"
import { getInventoryBalances } from "@/lib/stock-inventories-repo"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/stock/inventories/balances?warehouse&date&forDayEnd=0|1 → StockInventoryBalances:
// every catalog item with its system balance in that warehouse at the start / end of the day
// (demo stock/all_balances/?stock&date&for_day_end for the create dialog), from the stock core.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseBalancesQuery(request.url)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await getInventoryBalances({ ...parsed.data, date: parsed.data.date || todayIso() }))
  } catch (error) {
    console.error("stock inventories: balances", error)
    return NextResponse.json({ error: "Не удалось загрузить остатки склада" }, { status: 503 })
  }
}
