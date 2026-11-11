import { NextRequest, NextResponse } from "next/server"

import { requirePurchaseReader } from "@/lib/company-money"
import { withDbErrors } from "@/lib/db-errors"
import { entryBodySchema, entryResponse, legacyRow, parseListQuery, toEntryInput } from "@/lib/net-cost-api"
import { createNetCostEntry } from "@/lib/net-cost-entries"
import { listNetCost } from "@/lib/net-cost-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

/** "Себестоимость" list (demo stock/net_cost/). With page / pageSize: `{count, page, pageSize,
 * results, currency}`; without: the legacy array of {id, name, warehouse, avgCost, cost, passed, …}. */
export const GET = withDbErrors(async function GET(request: NextRequest) {
  const reader = await requirePurchaseReader()
  if (reader.error) return reader.error
  const { query, paged } = parseListQuery(request.url)
  if (paged) return NextResponse.json(await listNetCost(query))
  const all = await listNetCost({ ...query, page: 1, pageSize: 0 })
  return NextResponse.json(all.results.map(legacyRow))
})

/** "Добавить себестоимость": {item: "product:<id>", cost, date: YYYY-MM-DD, warehouse ('' = Общий), comment}. */
export const POST = withDbErrors(async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, entryBodySchema)
  if (parsed.error) return parsed.error
  return entryResponse(await createNetCostEntry(toEntryInput(parsed.data), auth.user.displayName), 201)
})
