import { NextResponse } from "next/server"

import { staffExpenseDetail } from "@/lib/cash/reports"
import { badReportParam, reportQuery } from "@/app/api/cash/reports/query"
import { isDbId } from "@/lib/cash/common"
import { parseIdSegment } from "@/lib/validation"

// GET /api/cash/reports/staff-expenses/detail?employee=<id>&from&to&branch*&organization*&expenseCategory*&page&pageSize
// → ExpenseReportDetail: "Общая сумма" per currency + the paged allocations of that employee.
export async function GET(request: Request) {
  const parsed = await reportQuery(request.url)
  if (parsed.error) return parsed.error
  const { filters, paging, params } = parsed.data
  const employee = (parseIdSegment(params.get("employee")) ?? 0)
  if (!isDbId(employee)) return badReportParam("employee", "employees.id")
  return NextResponse.json(await staffExpenseDetail(employee, { ...filters, page: paging.page, pageSize: paging.pageSize }))
}
