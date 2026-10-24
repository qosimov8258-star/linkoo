import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { errorResponse, notFound, requireViewer, routeId, schemas, type RouteParams } from "@/lib/production-api"
import { deleteParty, getPartyDetail, updateParty } from "@/lib/production-batches-repo"

export async function GET(_request: Request, context: RouteParams) {
  const denied = await requireViewer()
  if (denied) return denied
  const id = await routeId(context)
  const party = id ? await getPartyDetail(id) : null
  return party ? NextResponse.json(party) : notFound("Партия не найдена")
}

export async function PUT(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound("Партия не найдена")
  const parsed = await parseJsonBody(request, schemas.partyUpdate)
  if (parsed.error) return parsed.error
  const result = await updateParty(id, parsed.data)
  if (result === "not_found") return notFound("Партия не найдена")
  if (result === "stage_not_found") return notFound("Этап не найден")
  if (result === "stage_locked") return errorResponse("В партии уже есть товары — этап изменить нельзя", 409)
  return NextResponse.json(result)
}

export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound("Партия не найдена")
  const result = await deleteParty(id)
  if (result === "not_found") return notFound("Партия не найдена")
  if (result === "finished") return errorResponse("Завершенную партию удалить нельзя", 409)
  return NextResponse.json({ ok: true })
}
