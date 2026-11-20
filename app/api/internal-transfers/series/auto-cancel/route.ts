import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { withDbErrors } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { TransferSeriesError, cancelTransferAutoSeries } from "@/lib/internal-transfers-series-auto"

const schema = z.object({ ids: z.array(z.number().int().positive().max(2_147_483_647)).min(1).max(500) })

/** POST {ids} — «Отменить автораспределение» (Linko's stock/stock_transfer/auto_set_cancel/): clears the series the
 * auto distribution set; {transfers, lines}. */
export const POST = withDbErrors(async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await cancelTransferAutoSeries(parsed.data.ids))
  } catch (error) {
    if (error instanceof TransferSeriesError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
})
