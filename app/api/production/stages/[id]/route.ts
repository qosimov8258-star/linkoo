import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { guarded, notFound, parseBody, schemas, type RouteParams } from "@/lib/production-api"
import { deleteStage, updateStage } from "@/lib/production-stages-repo"
import { parseIdSegment } from "@/lib/validation"

export async function PUT(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound()
  const parsed = await parseBody(request, schemas.stage)
  if (parsed.error) return parsed.error
  return guarded(async () => {
    const stage = await updateStage(id, parsed.data)
    return stage ? NextResponse.json(stage) : notFound("Этап не найден")
  })
}

/** 409 {error, usage} while batches or shift entries reference the stage. */
export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound()
  return guarded(async () => ((await deleteStage(id)) === "not_found" ? notFound("Этап не найден") : NextResponse.json({ ok: true })))
}
