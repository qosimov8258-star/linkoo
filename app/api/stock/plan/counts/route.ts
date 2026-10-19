import { NextResponse } from "next/server"

import { countPlanTasks } from "@/lib/stock-plan"
import { planAuth, planFailure } from "@/lib/stock-plan-api"

// GET /api/stock/plan/counts?warehouse* → {receive, transfer, receive_history, transfer_history} (tab badges).
export async function GET(request: Request) {
  const denied = await planAuth()
  if (denied) return denied
  const warehouses = [...new Set(new URL(request.url).searchParams.getAll("warehouse").map((value) => value.trim()).filter(Boolean))]
  try {
    return NextResponse.json(await countPlanTasks(warehouses))
  } catch (error) {
    return planFailure(error)
  }
}
