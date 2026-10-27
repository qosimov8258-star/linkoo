import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { PRICE_LIST_CALC_METHODS } from "@/components/analytics/price-lists-data"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/price-lists/calc-methods — demo GET sales/price_list/calc_method/: [{id, name, keys}].
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(PRICE_LIST_CALC_METHODS)
}
