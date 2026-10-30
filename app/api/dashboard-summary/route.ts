import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDashboardSummary } from "@/lib/dashboard-summary-repo"
import { fieldScopeOf, scopedEmployeeIds } from "@/lib/field-activity/actor"
import { hasPermission } from "@/lib/rbac"
import { invalidFieldResponse } from "@/lib/validation"

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= "2100-12-31"
}

// GET /api/dashboard-summary?begin=YYYY-MM-DD&end=YYYY-MM-DD → DashboardSummary (local days, inclusive).
// The field block (attendance tiles, successful visits) follows the reader's field scope
// (lib/field-activity/actor.ts): an agent gets only their own figures, a user without any field
// scope an empty block.
// The money block (Продажи, Оплаты, Возвраты, АКБ, units, order statuses) shows the whole company
// to the readers with the full field scope and to the holders of COMPANY_MONEY_PERMISSIONS
// (accountants, cashiers, report / dashboard staff); everyone else, the agents first of all (who
// hold payments.manage for collecting money), sees only the orders, client payments and returns of
// their own field scope (themselves and the agents they supervise), nothing without one.
const COMPANY_MONEY_PERMISSIONS = ["finance.manage", "cash.manage", "reports.manage"]

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const begin = request.nextUrl.searchParams.get("begin")
  const end = request.nextUrl.searchParams.get("end")
  if (!begin || !end) {
    return NextResponse.json({ error: "Требуются begin и end" }, { status: 400 })
  }
  if (!validDay(begin) || !validDay(end)) {
    return invalidFieldResponse(validDay(begin) ? "end" : "begin", "YYYY-MM-DD")
  }
  if (begin > end) {
    return NextResponse.json({ error: "begin должен быть не позже end" }, { status: 400 })
  }

  const scope = await fieldScopeOf(user)
  const fieldIds = scope ? scopedEmployeeIds(scope, undefined) : []
  const companyMoney = scope?.all === true || COMPANY_MONEY_PERMISSIONS.some((code) => hasPermission(user, code))
  return NextResponse.json(await getDashboardSummary(begin, end, fieldIds, companyMoney ? undefined : (fieldIds ?? [])))
}
