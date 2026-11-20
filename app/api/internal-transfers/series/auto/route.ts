import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { withDbErrors } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { TRANSFER_SERIES_AUTO_TYPES, TransferSeriesError, autoDistributeTransferSeries } from "@/lib/internal-transfers-series-auto"
import type { TransferSeriesAutoType } from "@/lib/internal-transfers-types"

const id = z.number().int().positive().max(2_147_483_647)
const schema = z.object({
  autoType: z.enum(TRANSFER_SERIES_AUTO_TYPES as [string, ...string[]]).optional(),
  ids: z.array(id).min(1).max(500),
})

/** POST {autoType: fifo | lifo (default fifo), ids} — «Авто распределение по сериям» (Linko's
 * stock/stock_transfer/auto_set/): {transfers, lines, unassigned}. */
export const POST = withDbErrors(async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await autoDistributeTransferSeries(parsed.data.ids, (parsed.data.autoType ?? "fifo") as TransferSeriesAutoType))
  } catch (error) {
    if (error instanceof TransferSeriesError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
})
