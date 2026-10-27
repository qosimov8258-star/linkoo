import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { entryBodySchema, entryResponse, toEntryInput } from "@/lib/net-cost-api"
import { deleteNetCostEntry, updateNetCostEntry } from "@/lib/net-cost-entries"
import { getNetCostDetail } from "@/lib/net-cost-repo"
import { requireRole } from "@/lib/rbac"
import { parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const recordId = async (params: RouteParams["params"]) => {
  return parseIdSegment((await params).id)
}

/** One cost record with its documents and the negative-balance transactions. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = await recordId(params)
  const detail = id ? await getNetCostDetail(id) : null
  return detail ? NextResponse.json(detail) : NextResponse.json({ error: "Себестоимость не найдена" }, { status: 404 })
}

/** "Изменить себестоимость" (manual records only): cost, date, warehouse, comment. */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await recordId(params)
  if (!id) return NextResponse.json({ error: "Себестоимость не найдена" }, { status: 404 })
  const parsed = await parseJsonBody(request, entryBodySchema)
  if (parsed.error) return parsed.error
  return entryResponse(await updateNetCostEntry(id, toEntryInput(parsed.data)))
}

/** Deletes a manual record; its documents fall back to the previous cost of the item. */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await recordId(params)
  if (!id) return NextResponse.json({ error: "Себестоимость не найдена" }, { status: 404 })
  return entryResponse(await deleteNetCostEntry(id))
}
