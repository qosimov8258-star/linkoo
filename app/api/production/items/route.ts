import { NextResponse } from "next/server"

import { errorResponse, isDateParam, notFound, positiveIntParam, requireViewer } from "@/lib/production-api"
import { getProductionDb } from "@/lib/production-schema"
import { getStage } from "@/lib/production-stages-repo"
import { listCatalog, listWarehouseItems } from "@/lib/production-stock"

/** Products and raw materials; with `stageId`, each carries its available /
 * on-hand quantity, brak and unit cost in that stage's warehouse at the end
 * of `date` (default today). */
export async function GET(request: Request) {
  const denied = await requireViewer()
  if (denied) return denied
  const db = await getProductionDb()
  const params = new URL(request.url).searchParams
  const stageId = positiveIntParam(params.get("stageId"))
  if (!stageId) return NextResponse.json(await listCatalog(db))
  const stage = await getStage(stageId)
  if (!stage) return notFound("Этап не найден")
  const date = params.get("date")
  if (date !== null && !isDateParam(date)) return errorResponse("Неверная дата")
  return NextResponse.json(await listWarehouseItems(db, stage.warehouse, date ?? undefined))
}
