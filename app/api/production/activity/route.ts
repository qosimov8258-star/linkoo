import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { dateParamError, errorResponse, guarded, isDateParam, notFound, parseBody, positiveIntParam, requireViewer, schemas } from "@/lib/production-api"
import { addActivity, getActivity } from "@/lib/production-activity-repo"

/** GET /api/production/activity?stageId&from&to[&shift=<name> (repeatable: any of them)&worker&type=made|raw&equipmentId] */
export async function GET(request: Request) {
  const denied = await requireViewer()
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const stageId = positiveIntParam(params.get("stageId"))
  const from = params.get("from")
  const to = params.get("to")
  // A day that is given but is no valid day: 400 «Неверная дата» with its field; the line after answers missing values.
  const badDate = dateParamError(params, "from", "to")
  if (badDate) return badDate
  if (!stageId || !isDateParam(from) || !isDateParam(to)) return errorResponse("stageId, from и to обязательны")
  const type = params.get("type") ?? ""
  const direction = type === "made" || type === "raw" ? type : undefined
  if (type && !direction) return errorResponse("Неверное значение", 400, { field: "type" })
  const shifts = params
    .getAll("shift")
    .map((value) => value.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 50)
  return NextResponse.json(
    await getActivity(stageId, {
      from,
      to,
      shifts,
      direction,
      equipmentId: positiveIntParam(params.get("equipmentId")),
      worker: params.get("worker")?.trim().slice(0, 255) || undefined,
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
