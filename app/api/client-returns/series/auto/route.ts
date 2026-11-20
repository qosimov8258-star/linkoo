import { NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { returnSeriesAutoSchema } from "@/lib/client-returns-series-api"
import { autoDistributeReturnSeries, type SeriesAutoType } from "@/lib/client-returns-series-repo"
import { orderErrorResponse } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

// POST /api/client-returns/series/auto {autoType: fifo | lifo | from_market, ids} — «Авто распределение по сериям»
// (Linko's order_return_product_exp/auto_set/) of the open return or the ticked ones: {returns, rows}.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, returnSeriesAutoSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await autoDistributeReturnSeries(parsed.data.ids, parsed.data.autoType as SeriesAutoType, auth.user))
  } catch (error) {
    return orderErrorResponse(error)
  }
}
