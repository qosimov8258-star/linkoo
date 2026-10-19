import { NextResponse } from "next/server"

import { getPlanItem } from "@/lib/stock-plan"
import { planAuth, planFailure } from "@/lib/stock-plan-api"
import { PLAN_TYPE_LABELS, type PlanTaskType } from "@/lib/stock-plan-types"

// GET /api/stock/plan/item?type=supply|transfer|order&id=N → PlanItemDetail (the row's document and products).
export async function GET(request: Request) {
  const denied = await planAuth()
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const type = (params.get("type") ?? "").trim()
  const id = Number(params.get("id"))
  if (!(type in PLAN_TYPE_LABELS) || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Ma'lumotlar noto'g'ri" }, { status: 400 })
  }
  try {
    const item = await getPlanItem(type as PlanTaskType, id)
    return item ? NextResponse.json(item) : NextResponse.json({ error: "Документ не найден" }, { status: 404 })
  } catch (error) {
    return planFailure(error)
  }
}
