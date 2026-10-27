import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getNetCostOptions } from "@/lib/net-cost-repo"
import { notSignedInResponse } from "@/lib/validation"

/** Pickers of the page: catalog items, warehouses, base currency, check (fault) types. */
export async function GET() {
  if (!(await getCurrentUser())) return notSignedInResponse()
  return NextResponse.json(await getNetCostOptions())
}
