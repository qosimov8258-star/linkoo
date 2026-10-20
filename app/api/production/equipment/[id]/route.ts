import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { guarded, notFound, parseBody, schemas, type RouteParams } from "@/lib/production-api"
import { deleteEquipment, updateEquipment } from "@/lib/production-stages-repo"
import { parseIdSegment } from "@/lib/validation"

export async function PUT(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound()
  const parsed = await parseBody(request, schemas.equipment)
  if (parsed.error) return parsed.error
  return guarded(async () => {
    const row = await updateEquipment(id, parsed.data)
    return row ? NextResponse.json(row) : notFound()
  })
}

export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound()
  return guarded(async () => ((await deleteEquipment(id)) ? NextResponse.json({ ok: true }) : notFound()))
}
