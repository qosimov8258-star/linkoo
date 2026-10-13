import { NextResponse } from "next/server"

import { branchKpiCopySchema, branchKpiErrorResponse } from "@/lib/branch-kpi-api"
import { recalcBranchKpi } from "@/lib/branch-kpi-balance"
import { copyBranchKpiPlans } from "@/lib/branch-kpi-plans-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// POST /api/branch-kpi-plans/copy { branches, isAll, fromMonth, fromYear, toMonth, toYear } —
// "Дублировать" (demo POST staff/branch_performance/copy/); the target month is recalculated.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, branchKpiCopySchema)
  if (parsed.error) return parsed.error
  try {
    const copied = await copyBranchKpiPlans(parsed.data)
    if (copied) await recalcBranchKpi(parsed.data.toYear, parsed.data.toMonth, auth.user.displayName || auth.user.username)
    return NextResponse.json({ copied })
  } catch (error) {
    return branchKpiErrorResponse(error)
  }
}
