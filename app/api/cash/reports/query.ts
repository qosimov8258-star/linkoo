import "server-only"

import { NextResponse } from "next/server"

import { requireCompanyMoneyReader } from "@/lib/company-money"
import { parseCashListQuery } from "@/lib/cash/api"
import type { ExpenseReportFilters, ExpenseReportPaging } from "@/lib/cash/reports"
import { invalidFieldResponse } from "@/lib/validation"

// Shared query parsing of the report routes ("Расходы по категориям",
// "Расходы на персонал"): from to branch* organization* expenseCategory*
// search page pageSize (0 = all). Lists are repeated params; ids also "1-2-3".

export type ReportQuery = { filters: ExpenseReportFilters; paging: ExpenseReportPaging; params: URLSearchParams }

export async function reportQuery(url: string): Promise<{ data: ReportQuery; error?: undefined } | { data?: undefined; error: NextResponse }> {
  const reader = await requireCompanyMoneyReader()
  if (reader.error) return { error: reader.error }
  const parsed = parseCashListQuery(url)
  if (parsed.error) return { error: parsed.error }
  const q = parsed.data
  return {
    data: {
      filters: { from: q.from, to: q.to, branches: q.branches, organizations: q.organizations, expenseCategoryIds: q.expenseCategoryIds },
      paging: { search: q.search, page: q.page, pageSize: q.pageSize },
      params: new URL(url).searchParams,
    },
  }
}

export function badReportParam(name: string, hint: string) {
  return invalidFieldResponse(name, hint)
}
