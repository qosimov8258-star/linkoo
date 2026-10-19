import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { isIsoDay } from "@/lib/finance/dates"
import { stockPickRows } from "@/lib/internal-transfers-stock"

/** Product picker: items of `warehouse` with their available balance
 * (stock core) and the price in `priceList`; `include` adds keys already on the document. */
export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const params = new URL(request.url).searchParams
  const warehouse = (params.get("warehouse") ?? "").trim()
  if (!warehouse) return NextResponse.json({ error: "Склад не выбран" }, { status: 400 })
  const priceList = (params.get("priceList") ?? "").trim()
  const date = params.get("date") ?? ""
  const include = params.getAll("include").map((key) => key.trim()).filter(Boolean).slice(0, 2000)
  const rows = await stockPickRows(warehouse, { priceList, day: isIsoDay(date) ? date : undefined, includeKeys: include })
  return NextResponse.json({ warehouse, priceList, rows })
}
