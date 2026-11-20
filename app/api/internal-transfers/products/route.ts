import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"
import { productFacts } from "@/lib/internal-transfers-series"
import { isIsoDay } from "@/lib/finance/dates"
import { stockPickRows } from "@/lib/internal-transfers-stock"
import { notSignedInResponse } from "@/lib/validation"

/** Product picker: items of `warehouse` with their available balance
 * (stock core) and the price in `priceList`; `include` adds keys already on the document. */
export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) return notSignedInResponse()
  const params = new URL(request.url).searchParams
  const warehouse = (params.get("warehouse") ?? "").trim()
  if (!warehouse) return NextResponse.json({ error: "Склад не выбран" }, { status: 400 })
  const priceList = (params.get("priceList") ?? "").trim()
  const date = params.get("date") ?? ""
  const include = params.getAll("include").map((key) => key.trim()).filter(Boolean).slice(0, 2000)
  const rows = await stockPickRows(warehouse, { priceList, day: isIsoDay(date) ? date : undefined, includeKeys: include })
  // The form's Серия field and box (Группа) field follow the product.
  const facts = await productFacts(
    getDb(),
    rows.map((row) => row.key),
  )
  return NextResponse.json({
    warehouse,
    priceList,
    rows: rows.map((row) => {
      const fact = facts.get(row.key)
      return fact ? { ...row, trackExpiry: fact.trackExpiry, boxAmount: fact.boxAmount, boxUnit: fact.boxUnit } : row
    }),
  })
}
