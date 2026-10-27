import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseIdSegment, parseJsonBody } from "@/lib/validation"
import { cashErrorResponse } from "@/lib/cash/api"
import { isDbId } from "@/lib/cash/common"
import { cashManagementEntrySchema, deleteCashManagementEntry, updateCashManagementEntry } from "@/lib/cash-management-entries-repo"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Запись не найдена", field: null }

// PUT    /api/cash-management-entries/[id] (legacy shape) → { key, source, id, docNo, entry } — edit through the cash core.
// DELETE /api/cash-management-entries/[id] → { ok, deleted: [keys] } — the cash core's soft delete.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = (parseIdSegment((await params).id) ?? 0)
  if (!isDbId(id)) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, cashManagementEntrySchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await updateCashManagementEntry(id, parsed.data, auth.user.displayName))
  } catch (error) {
    return cashErrorResponse(error)
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = (parseIdSegment((await params).id) ?? 0)
  if (!isDbId(id)) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const result = await deleteCashManagementEntry(id, auth.user.displayName)
    if (!result.deleted.length) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true, deleted: result.deleted })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
