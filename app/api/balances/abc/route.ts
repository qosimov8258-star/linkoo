import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseAbcQuery } from "@/lib/finance/api"
import { getAbc } from "@/lib/finance/pnl"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/balances/abc — ABC analysis of the orders created in [from, to]
// (cancelled / unconfirmed excluded), sales in the base currency.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseAbcQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await getAbc(parsed.data))
}
