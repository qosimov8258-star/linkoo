import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { errorResponse, notFound, routeId, schemas, type RouteParams } from "@/lib/production-api"
import { deleteStage, updateStage } from "@/lib/production-stages-repo"

export async function PUT(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound()
  const parsed = await parseJsonBody(request, schemas.stage)
  if (parsed.error) return parsed.error
  const stage = await updateStage(id, parsed.data)
  return stage ? NextResponse.json(stage) : notFound()
}

export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound()
  const result = await deleteStage(id)
  if (result === "not_found") return notFound()
  if (result === "in_use") return errorResponse("По этапу уже есть партии или движения — удалить нельзя", 409)
  return NextResponse.json({ ok: true })
}
