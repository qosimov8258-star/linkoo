import { NextResponse } from "next/server"

import { notFound, positiveIntParam, requireViewer } from "@/lib/production-api"
import { getProductionDb } from "@/lib/production-schema"
import { getStage } from "@/lib/production-stages-repo"
import { listCatalog, listWarehouseItems } from "@/lib/production-stock"

/** Products and raw materials; with `stageId`, each carries its available
 * quantity, defect total and average cost in that stage's warehouse. */
export async function GET(request: Request) {
  const denied = await requireViewer()
  if (denied) return denied
  const db = await getProductionDb()
  const stageId = positiveIntParam(new URL(request.url).searchParams.get("stageId"))
  if (!stageId) return NextResponse.json(await listCatalog(db))
  const stage = await getStage(stageId)
  if (!stage) return notFound("Этап не найден")
  return NextResponse.json(await listWarehouseItems(db, stage.warehouse))
}
