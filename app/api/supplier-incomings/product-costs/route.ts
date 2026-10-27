import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listProductCosts } from "@/lib/supplier-incomings-repo"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/supplier-incomings/product-costs → { baseCurrency, costs: { [productId]: unitCost } }:
// the one cost of goods (lib/stock/costs.ts, base currency, today) of every live product,
// read by "Формирование цен" and the supply "Наценка" dialog.
export async function GET() {
  if (!(await getCurrentUser())) return notSignedInResponse()
  return NextResponse.json(await listProductCosts())
}
