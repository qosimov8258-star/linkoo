import { NextResponse } from "next/server"

import { requirePurchaseReader } from "@/lib/company-money"
import { getNetCostTotals } from "@/lib/net-cost-repo"

/** Header table (demo stock/net_cost/total/): "Общий" first, then every warehouse. */
export async function GET() {
  const reader = await requirePurchaseReader()
  if (reader.error) return reader.error
  return NextResponse.json(await getNetCostTotals())
}
