import { NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import type { SeriesAutoType } from "@/lib/client-returns-series-repo"
import { orderSeriesAutoSchema } from "@/lib/order-series-api"
import { autoDistributeOrderSeries } from "@/lib/order-series-repo"
import { orderErrorResponse } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

// POST /api/orders/series/auto {autoType: fifo | lifo | from_market, ids} — «Авто распределение по сериям» (Linko's
// order_product_exp/auto_set/) of the open order or the ticked ones: {orders, rows, unassigned}.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, orderSeriesAutoSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await autoDistributeOrderSeries(parsed.data.ids, parsed.data.autoType as SeriesAutoType, auth.user))
  } catch (error) {
    return orderErrorResponse(error)
  }
}
