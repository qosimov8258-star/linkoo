import { NextResponse } from "next/server"

import { parseMoveFilters, parsePlanPaging, planAuth, planFailure } from "@/lib/stock-plan-api"
import { listPlanMovements } from "@/lib/stock-plan-movements"

// GET /api/stock/plan/movements?warehouse*&type*&product*&typeParent*&subcategory*&from&to&search
//   &ordering=[-]day|qty|warehouse|docNumber&page&pageSize (0 = all)
// → PlanMovementResult ("Движение товаров", demo stock/barcode_history): the stock ledger lines.
export async function GET(request: Request) {
  const denied = await planAuth()
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const filters = parseMoveFilters(params)
  if (filters.error) return filters.error
  try {
    return NextResponse.json(await listPlanMovements(filters.value, parsePlanPaging(params)))
  } catch (error) {
    return planFailure(error)
  }
}
