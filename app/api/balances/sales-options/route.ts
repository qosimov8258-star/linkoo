import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getSalesReportOptions } from "@/lib/finance/pnl"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/balances/sales-options → SalesReportOptions: the factory's own
// branches, organizations, product types, brands, products, zones and order
// agents, for the filter dropdowns of the sales reports.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await getSalesReportOptions())
}
