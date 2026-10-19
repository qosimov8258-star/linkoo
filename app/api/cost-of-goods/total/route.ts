import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getNetCostTotals } from "@/lib/net-cost-repo"

/** Header table (demo stock/net_cost/total/): "Общий" first, then every warehouse. */
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await getNetCostTotals())
}
