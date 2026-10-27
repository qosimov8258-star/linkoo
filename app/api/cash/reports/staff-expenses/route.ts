import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseCashListQuery } from "@/lib/cash/api"
import { staffExpenseRows } from "@/lib/cash/reports"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/cash/reports/staff-expenses?from&to&branch*&organization*&expenseCategory*&staff*
// → { baseCurrency, rows: StaffExpenseRow[] } ("Расходы на персонал": group by employee; drill-down = staff=<id>).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseCashListQuery(request.url)
  if (parsed.error) return parsed.error
  const q = parsed.data
  return NextResponse.json(
    await staffExpenseRows({
      from: q.from,
      to: q.to,
      branches: q.branches,
      organizations: q.organizations,
      expenseCategoryIds: q.expenseCategoryIds,
      employeeIds: q.staffIds,
    }),
  )
}
