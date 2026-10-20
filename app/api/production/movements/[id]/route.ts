import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { errorResponse, guarded, notFound, type RouteParams } from "@/lib/production-api"
import { deleteMovement } from "@/lib/production-batches-repo"
import { parseIdSegment } from "@/lib/validation"

export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound()
  return guarded(async () => {
    const result = await deleteMovement(id)
    if (result === "not_found") return notFound()
    if (result === "not_pending") return errorResponse("Партия уже завершена", 409)
    return NextResponse.json({ ok: true })
  })
}
