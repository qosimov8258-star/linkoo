import { NextResponse } from "next/server"

import { errorResponse, isDateParam, itemsWithCostVisibility, notFound, positiveIntParam, requireProductionReader } from "@/lib/production-api"
import { getProductionDb } from "@/lib/production-schema"
import { getStage } from "@/lib/production-stages-repo"
import { listCatalog, listWarehouseItems } from "@/lib/production-stock"

/** Products and raw materials; with `stageId`, each carries its available /
 * on-hand quantity, brak and unit cost in that stage's warehouse at the end
 * of `date` (default today). */
export async function GET(request: Request) {
  // ACCESS: the unit cost only for the readers of costs (lib/production-api.ts requireProductionReader).
  const reader = await requireProductionReader()
  if (reader.error) return reader.error
  const db = await getProductionDb()
  const params = new URL(request.url).searchParams
  const rawStage = params.get("stageId")
  const stageId = positiveIntParam(rawStage)
  // A stageId that is given but is no stage id (?stageId=abc) is an unknown stage, not a request for the catalogue.
  if (rawStage !== null && rawStage.trim() !== "" && !stageId) return notFound("Этап не найден")
  if (!stageId) return NextResponse.json(await listCatalog(db))
  const stage = await getStage(stageId)
  if (!stage) return notFound("Этап не найден")
  const date = params.get("date")
  if (date !== null && !isDateParam(date)) return errorResponse("Неверная дата")
  return NextResponse.json(itemsWithCostVisibility(await listWarehouseItems(db, stage.warehouse, date ?? undefined), reader.canSeeCost))
}
