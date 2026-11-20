import { NextResponse } from "next/server"

import { dateParamError, errorResponse, isDateParam, notFound, positiveIntParam, requireViewer } from "@/lib/production-api"
import { listInventories } from "@/lib/production-activity-repo"
import { getStage } from "@/lib/production-stages-repo"

// The stage's own reconciliations of earlier versions, read only: «Сверить» opens the warehouse's
// inventory (Склад → Инвентаризация, /api/stock/inventories) now, as the reference does.
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
  // An unknown stage is 404, as for /api/production/recipes, /items and /equipment (not an empty list).
  if (!(await getStage(stageId))) return notFound("Этап не найден")
  return NextResponse.json(await listInventories(stageId, from, to))
}
