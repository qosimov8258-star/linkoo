import { NextResponse } from "next/server"

import { branchKpiPeriodQuerySchema, invalidQueryResponse, searchParamsObject } from "@/lib/branch-kpi-api"
import { getBranchKpiDetail } from "@/lib/branch-kpi-balance"
import { getCurrentUser } from "@/lib/current-user"
import { parseIdSegment } from "@/lib/validation"

// GET /api/branch-kpi-plans/:id?month&year — the branch's KPI balances of the month
// (demo GET staff/branch_performance/:id/).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = (parseIdSegment((await params).id) ?? 0)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Ma'lumotlar noto'g'ri" }, { status: 400 })
  const query = branchKpiPeriodQuerySchema.safeParse(searchParamsObject(new URL(request.url).searchParams))
  if (!query.success) return invalidQueryResponse(query.error)
  const detail = await getBranchKpiDetail(id, query.data.year, query.data.month)
  if (!detail) return NextResponse.json({ error: "Филиал не найден" }, { status: 404 })
  return NextResponse.json(detail)
}
