import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { errorResponse, guarded, isDateParam, notFound, parseBody, positiveIntParam, requireViewer, schemas } from "@/lib/production-api"
import { addActivity, getActivity } from "@/lib/production-activity-repo"

export async function GET(request: Request) {
  const denied = await requireViewer()
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const stageId = positiveIntParam(params.get("stageId"))
  const from = params.get("from")
  const to = params.get("to")
  if (!stageId || !isDateParam(from) || !isDateParam(to)) return errorResponse("stageId, from и to обязательны")
  return NextResponse.json(
    await getActivity(stageId, {
      from,
      to,
      shift: params.get("shift") || undefined,
      equipmentId: positiveIntParam(params.get("equipmentId")),
      worker: params.get("worker") || undefined,
    }),
  )
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, schemas.activity)
  if (parsed.error) return parsed.error
  const { stageId, items, ...rest } = parsed.data
  return guarded(async () => {
    const inserted = await addActivity(
      stageId,
      { ...rest, items: items.map(({ key, amount, isDefect }) => ({ kind: key.kind, id: key.id, amount, isDefect })) },
      auth.user.displayName,
    )
    if (inserted === "stage_not_found") return notFound("Этап не найден")
    if (!inserted) return errorResponse("Добавьте хотя бы один товар")
    return NextResponse.json({ inserted }, { status: 201 })
  })
}
