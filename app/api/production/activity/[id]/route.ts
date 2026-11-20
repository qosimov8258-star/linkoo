import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { guarded, notFound, parseBody, routeId, schemas, type RouteParams } from "@/lib/production-api"
import { deleteActivityEntry, updateActivityAmount } from "@/lib/production-activity-repo"

// «Записи» row actions of a shift entry (a stage's made / raw line outside any batch), as the reference's
// PUT …/<id>/update_amount/ and DELETE …/<id>/: PUT {amount} changes its amount, DELETE removes it.
// Batch lines are changed in their batch (404 here). Stock that would go short on any day → 409.

export async function PUT(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound()
  const parsed = await parseBody(request, schemas.activityAmount)
  if (parsed.error) return parsed.error
  return guarded(async () => {
    if ((await updateActivityAmount(id, parsed.data.amount)) === "not_found") return notFound()
    return NextResponse.json({ ok: true })
  })
}

export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound()
  return guarded(async () => {
    if ((await deleteActivityEntry(id)) === "not_found") return notFound()
    return NextResponse.json({ ok: true })
  })
}
