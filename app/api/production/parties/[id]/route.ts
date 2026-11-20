import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { errorResponse, guarded, notFound, parseBody, requireProductionReader, routeId, schemas, withCostVisibility, type RouteParams } from "@/lib/production-api"
import { deleteParty, getPartyDetail, STAGE_WAREHOUSE_LOCKED, updateParty } from "@/lib/production-batches-repo"
import { parseIdSegment } from "@/lib/validation"

export async function GET(_request: Request, context: RouteParams) {
  // ACCESS: the cost figures only for the readers of costs (lib/production-api.ts requireProductionReader).
  const reader = await requireProductionReader()
  if (reader.error) return reader.error
  const id = parseIdSegment((await context.params).id)
  const party = id ? await getPartyDetail(id) : null
  return party ? NextResponse.json(withCostVisibility(party, reader.canSeeCost)) : notFound("Партия не найдена")
}

export async function PUT(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound("Партия не найдена")
  const parsed = await parseBody(request, schemas.partyUpdate)
  if (parsed.error) return parsed.error
  return guarded(async () => {
    const result = await updateParty(id, parsed.data)
    if (result === "not_found") return notFound("Партия не найдена")
    if (result === "stage_not_found") return notFound("Этап не найден")
    if (result === "stage_locked") return errorResponse(STAGE_WAREHOUSE_LOCKED, 409)
    return NextResponse.json(result)
  })
}

export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound("Партия не найдена")
  // deleteParty refuses with a ProductionError (e.g. 409 when undoing the batch's output would
  // make a stock negative) and may meet a lock timeout: guarded answers both as JSON, never 500.
  return guarded(async () => {
    const result = await deleteParty(id)
    if (result === "not_found") return notFound("Партия не найдена")
    if (result === "finished") return errorResponse("Завершенную партию удалить нельзя", 409)
    return NextResponse.json({ ok: true })
  })
}
