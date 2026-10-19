import { NextResponse } from "next/server"

import { branchKpiBulkSchema, branchKpiErrorResponse } from "@/lib/branch-kpi-api"
import { recalcBranchKpi } from "@/lib/branch-kpi-balance"
import { bulkSetBranchKpiPlans } from "@/lib/branch-kpi-plans-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// POST /api/branch-kpi-plans/bulk { month, year, branches: [{ branch, performanceIndicators:
// [{ performanceIndicator, plan }] }], indicators } — "Изменить планы" (demo POST
// staff/branch_performance/bulk_set_plan/); the month is recalculated afterwards.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, branchKpiBulkSchema)
  if (parsed.error) return parsed.error
  try {
    const updated = await bulkSetBranchKpiPlans(parsed.data)
    const recalc = await recalcBranchKpi(parsed.data.year, parsed.data.month, auth.user.displayName || auth.user.username)
    return NextResponse.json({ updated, lastDate: recalc.lastDate })
  } catch (error) {
    return branchKpiErrorResponse(error)
  }
}
