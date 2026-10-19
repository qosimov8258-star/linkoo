import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { errorResponse, notFound, routeId, type RouteParams } from "@/lib/production-api"
import { deleteMovement } from "@/lib/production-batches-repo"

export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  const result = id ? await deleteMovement(id) : "not_found"
  if (result === "not_found") return notFound()
  if (result === "not_pending") return errorResponse("Партия уже завершена", 409)
  return NextResponse.json({ ok: true })
}
