import { NextResponse } from "next/server"

import { listBranchKpiIndicators } from "@/lib/branch-kpi-plans-repo"
import { getCurrentUser } from "@/lib/current-user"

// GET /api/branch-kpi-plans/indicators — KPI indicators (our "KPI задачи") with the reward
// levels this page keeps for them (demo GET staff/performance_indicator/).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await listBranchKpiIndicators())
}
