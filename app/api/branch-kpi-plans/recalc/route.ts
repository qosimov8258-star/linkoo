import { NextResponse } from "next/server"

import { branchKpiRecalcSchema } from "@/lib/branch-kpi-api"
import { recalcBranchKpi } from "@/lib/branch-kpi-balance"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// POST /api/branch-kpi-plans/recalc { month, year } — "Перерасчет KPI" (demo POST
// staff/branch_performance/recalc_balance/) → { lastDate, branches }.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, branchKpiRecalcSchema)
  if (parsed.error) return parsed.error
  return NextResponse.json(await recalcBranchKpi(parsed.data.year, parsed.data.month, auth.user.displayName || auth.user.username))
}
