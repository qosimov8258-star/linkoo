import { NextResponse } from "next/server"

import { categoryExpenseDetail, isCategoryReportKey } from "@/lib/cash/reports"
import { badReportParam, reportQuery } from "@/app/api/cash/reports/query"

// GET /api/cash/reports/expenses-by-category/detail?key=<row key>&from&to&branch*&organization*&page&pageSize
// → ExpenseReportDetail: "Общая сумма" per currency + the paged operations of that category.
export async function GET(request: Request) {
  const parsed = await reportQuery(request.url)
  if (parsed.error) return parsed.error
  const { filters, paging, params } = parsed.data
  const key = params.get("key")?.trim() ?? ""
  if (!isCategoryReportKey(key)) return badReportParam("key", "expense:<id> | name:<name> | none")
  return NextResponse.json(await categoryExpenseDetail(key, { ...filters, expenseCategoryIds: undefined, page: paging.page, pageSize: paging.pageSize }))
}
