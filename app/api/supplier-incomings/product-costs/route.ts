import { NextResponse } from "next/server"

import { requirePurchaseReader } from "@/lib/company-money"
import { listProductCosts } from "@/lib/supplier-incomings-repo"

// GET /api/supplier-incomings/product-costs → { baseCurrency, costs: { [productId]: unitCost } }:
// the one cost of goods (lib/stock/costs.ts, base currency, today) of every live product,
// read by "Формирование цен" and the supply "Наценка" dialog.
export async function GET() {
  const reader = await requirePurchaseReader()
  if (reader.error) return reader.error
  return NextResponse.json(await listProductCosts())
}
