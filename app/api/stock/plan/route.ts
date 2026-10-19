import { NextResponse } from "next/server"

import { listPlanTasks } from "@/lib/stock-plan"
import { parsePlanPaging, parsePlanTab, parseTaskFilters, planAuth, planFailure } from "@/lib/stock-plan-api"

// GET /api/stock/plan?tab=receive|transfer|receive_history|transfer_history
//   &warehouse*&type=supply|transfer|order_return|order&doneBy*&from&to&search
//   &ordering=[-]id|date|requestDate|warehouse|type|party|deliverer|doneBy|doneAt&page&pageSize (0 = all)
// → PlanTaskListResult ("План приемок и передач", demo stock/income_tasks / outcome_tasks).
export async function GET(request: Request) {
  const denied = await planAuth()
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const tab = parsePlanTab(params)
  if (tab.error) return tab.error
  const filters = parseTaskFilters(params)
  if (filters.error) return filters.error
  try {
    return NextResponse.json(await listPlanTasks(tab.value, filters.value, parsePlanPaging(params)))
  } catch (error) {
    return planFailure(error)
  }
}
