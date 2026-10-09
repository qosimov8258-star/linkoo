import { NextResponse } from "next/server"

import { categoryExpenseReport } from "@/lib/cash/reports"
import { reportQuery } from "@/app/api/cash/reports/query"

// GET /api/cash/reports/expenses-by-category/list?from&to&branch*&organization*&search&page&pageSize (0 = all)
// → ExpenseReportList: one row per expense category, amount in the base currency, percent = share of the period total.
export async function GET(request: Request) {
  const parsed = await reportQuery(request.url)
  if (parsed.error) return parsed.error
  const { filters, paging } = parsed.data
  // Page 1 has no category filter (the rows are the categories).
  return NextResponse.json(await categoryExpenseReport({ ...filters, expenseCategoryIds: undefined, ...paging }))
}
