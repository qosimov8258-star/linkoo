import { NextResponse } from "next/server"

import { branchKpiErrorResponse, branchKpiRulesSchema } from "@/lib/branch-kpi-api"
import { recalcBranchKpi } from "@/lib/branch-kpi-balance"
import { saveBranchKpiRules } from "@/lib/branch-kpi-plans-repo"
import { requireRole } from "@/lib/rbac"
import { parseIdSegment, parseJsonBody, INVALID_DATA_MESSAGE } from "@/lib/validation"

// PUT /api/branch-kpi-plans/indicators/:id { bonusFund, levels, month?, year? } — the KPI's
// "Уровень вознаграждения" (demo stages of staff/performance_indicator/:id/); with month/year
// that month is recalculated so the bonuses follow the new rules.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = (parseIdSegment((await params).id) ?? 0)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: INVALID_DATA_MESSAGE }, { status: 400 })
  const parsed = await parseJsonBody(request, branchKpiRulesSchema)
  if (parsed.error) return parsed.error
  try {
    const userName = auth.user.displayName || auth.user.username
    const indicator = await saveBranchKpiRules(id, parsed.data, userName)
    if (parsed.data.month && parsed.data.year) await recalcBranchKpi(parsed.data.year, parsed.data.month, userName)
    return NextResponse.json(indicator)
  } catch (error) {
    return branchKpiErrorResponse(error)
  }
}
