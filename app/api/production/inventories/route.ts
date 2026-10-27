import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { errorResponse, guarded, isDateParam, notFound, parseBody, positiveIntParam, requireViewer, schemas } from "@/lib/production-api"
import { createInventory, listInventories } from "@/lib/production-activity-repo"

export async function GET(request: Request) {
  const denied = await requireViewer()
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const stageId = positiveIntParam(params.get("stageId"))
  const from = params.get("from")
  const to = params.get("to")
  if (!stageId || !isDateParam(from) || !isDateParam(to)) return errorResponse("stageId, from и to обязательны")
  return NextResponse.json(await listInventories(stageId, from, to))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, schemas.inventory)
  if (parsed.error) return parsed.error
  const { stageId, lines, ...input } = parsed.data
  return guarded(async () => {
    const inventory = await createInventory(
      stageId,
      { ...input, lines: lines.map((line) => ({ kind: line.key.kind, id: line.key.id, actual: line.actual })) },
      auth.user.displayName,
    )
    if (inventory === "stage_not_found") return notFound("Этап не найден")
    if (inventory === "empty") return errorResponse("Нет строк для сверки")
    return NextResponse.json(inventory, { status: 201 })
  })
}
