import { NextResponse } from "next/server"

import { branchKpiListQuerySchema, invalidQueryResponse, searchParamsObject } from "@/lib/branch-kpi-api"
import { listBranchKpi } from "@/lib/branch-kpi-plans-repo"
import { getCurrentUser } from "@/lib/current-user"

// GET /api/branch-kpi-plans?month&year&search&ordering&page&pageSize — branches with their
// KPI plans and the month's bonus total (demo GET staff/branch_performance/).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const query = branchKpiListQuerySchema.safeParse(searchParamsObject(new URL(request.url).searchParams))
  if (!query.success) return invalidQueryResponse(query.error)
  return NextResponse.json(await listBranchKpi(query.data))
}
