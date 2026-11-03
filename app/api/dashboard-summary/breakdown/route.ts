import { NextRequest, NextResponse } from "next/server"

import { COMPANY_MONEY_PERMISSIONS } from "@/lib/company-money"
import { getCurrentUser } from "@/lib/current-user"
import { BREAKDOWN_GROUPS, BREAKDOWN_MEASURES, getDashboardBreakdown, type BreakdownGroup, type BreakdownMeasure } from "@/lib/dashboard-breakdown-repo"
import { fieldScopeOf, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { hasPermission } from "@/lib/rbac"
import { invalidFieldResponse } from "@/lib/validation"

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= "2100-12-31"
}

// Same rule as GET /api/dashboard-summary: the company figures for the full field scope and the
// finance / cash / report staff, the reader's own agents for everyone else.

// GET /api/dashboard-summary/breakdown?begin&end&group&measure → DashboardBreakdown (the donut of the
// dashboard: the period's sales split by "Группировка", measured by "Измерять").
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const search = request.nextUrl.searchParams
  const begin = search.get("begin") ?? ""
  const end = search.get("end") ?? ""
  if (!validDay(begin)) return invalidFieldResponse("begin", "YYYY-MM-DD")
  if (!validDay(end)) return invalidFieldResponse("end", "YYYY-MM-DD")
  if (begin > end) return NextResponse.json({ error: "begin должен быть не позже end" }, { status: 400 })
  const group = search.get("group") || "По брендам"
  const measure = search.get("measure") || "Факт продажи"
  if (!(BREAKDOWN_GROUPS as readonly string[]).includes(group)) return invalidFieldResponse("group", BREAKDOWN_GROUPS.join(" | "))
  if (!(BREAKDOWN_MEASURES as readonly string[]).includes(measure)) return invalidFieldResponse("measure", BREAKDOWN_MEASURES.join(" | "))

  const scope = await fieldScopeOf(user)
  const fieldIds = scope ? scopedEmployeeIds(scope, undefined) : []
  const companyMoney = scope?.all === true || COMPANY_MONEY_PERMISSIONS.some((code) => hasPermission(user, code))
  return NextResponse.json(await getDashboardBreakdown(begin, end, group as BreakdownGroup, measure as BreakdownMeasure, companyMoney ? undefined : (fieldIds ?? [])))
}
