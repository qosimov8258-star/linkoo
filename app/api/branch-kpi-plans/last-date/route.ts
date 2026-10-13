import { NextResponse } from "next/server"

import { branchKpiPeriodQuerySchema, invalidQueryResponse, searchParamsObject } from "@/lib/branch-kpi-api"
import { branchKpiLastDate } from "@/lib/branch-kpi-plans-repo"
import { getCurrentUser } from "@/lib/current-user"

// GET /api/branch-kpi-plans/last-date?month&year → { lastDate } — when "Перерасчет KPI"
// last ran for the month (demo GET staff/branch_performance/last_date/).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const query = branchKpiPeriodQuerySchema.safeParse(searchParamsObject(new URL(request.url).searchParams))
  if (!query.success) return invalidQueryResponse(query.error)
  return NextResponse.json({ lastDate: await branchKpiLastDate(query.data.year, query.data.month) })
}
