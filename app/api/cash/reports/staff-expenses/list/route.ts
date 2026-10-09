import { NextResponse } from "next/server"

import { staffExpenseReport } from "@/lib/cash/reports"
import { reportQuery } from "@/app/api/cash/reports/query"

// GET /api/cash/reports/staff-expenses/list?from&to&branch*&organization*&expenseCategory*&search&page&pageSize (0 = all)
// → ExpenseReportList: one row per employee (Σ of the staff allocations, base currency).
export async function GET(request: Request) {
  const parsed = await reportQuery(request.url)
  if (parsed.error) return parsed.error
  const { filters, paging } = parsed.data
  return NextResponse.json(await staffExpenseReport({ ...filters, ...paging }))
}
