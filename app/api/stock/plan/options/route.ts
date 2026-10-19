import { NextResponse } from "next/server"

import { planAuth, planFailure } from "@/lib/stock-plan-api"
import { listPlanOptions } from "@/lib/stock-plan-movements"

// GET /api/stock/plan/options → {products: [{key, name}]} (the "Товар" filter of "Движение товаров").
export async function GET() {
  const denied = await planAuth()
  if (denied) return denied
  try {
    return NextResponse.json(await listPlanOptions())
  } catch (error) {
    return planFailure(error)
  }
}
