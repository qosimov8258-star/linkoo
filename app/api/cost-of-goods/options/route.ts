import { NextResponse } from "next/server"

import { requirePurchaseReader } from "@/lib/company-money"
import { getNetCostOptions } from "@/lib/net-cost-repo"

/** Pickers of the page: catalog items, warehouses, base currency, check (fault) types. */
export async function GET() {
  const reader = await requirePurchaseReader()
  if (reader.error) return reader.error
  return NextResponse.json(await getNetCostOptions())
}
