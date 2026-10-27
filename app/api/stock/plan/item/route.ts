import { NextResponse } from "next/server"

import { getPlanItem } from "@/lib/stock-plan"
import { planAuth, planFailure } from "@/lib/stock-plan-api"
import { PLAN_TYPE_LABELS, type PlanTaskType } from "@/lib/stock-plan-types"

// GET /api/stock/plan/item?type=supply|transfer|order|order_return&id=N → PlanItemDetail (the row's document and products).
export async function GET(request: Request) {
  const denied = await planAuth()
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const type = (params.get("type") ?? "").trim()
  const rawId = (params.get("id") ?? "").trim()
  const id = /^\d{1,10}$/.test(rawId) ? Number(rawId) : 0
  if (!Object.prototype.hasOwnProperty.call(PLAN_TYPE_LABELS, type)) return NextResponse.json({ error: "Неизвестный тип документа", field: "type" }, { status: 400 })
  if (!(id > 0 && id <= 2_147_483_647)) return NextResponse.json({ error: "Неверный идентификатор", field: "id" }, { status: 400 })
  try {
    const item = await getPlanItem(type as PlanTaskType, id)
    return item ? NextResponse.json(item) : NextResponse.json({ error: "Документ не найден" }, { status: 404 })
  } catch (error) {
    return planFailure(error)
  }
}
