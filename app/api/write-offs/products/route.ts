import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { isIsoDay } from "@/lib/finance/dates"
import { stockPickRows } from "@/lib/internal-transfers-stock"
import { notSignedInResponse } from "@/lib/validation"

/** "Списание товара" picker: items of `warehouse` with the available balance and cost (stock core). */
export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) return notSignedInResponse()
  const params = new URL(request.url).searchParams
  const warehouse = (params.get("warehouse") ?? "").trim()
  if (!warehouse) return NextResponse.json({ error: "Склад не выбран" }, { status: 400 })
  const date = params.get("date") ?? ""
  const rows = await stockPickRows(warehouse, { day: isIsoDay(date) ? date : undefined })
  return NextResponse.json({ warehouse, priceList: "", rows })
}
