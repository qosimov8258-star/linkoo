import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getNetCostOptions } from "@/lib/net-cost-repo"

/** Pickers of the page: catalog items, warehouses, base currency, check (fault) types. */
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await getNetCostOptions())
}
