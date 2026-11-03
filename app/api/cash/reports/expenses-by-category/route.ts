import { NextResponse } from "next/server"

import { requireCompanyMoneyReader } from "@/lib/company-money"
import { parseCashListQuery } from "@/lib/cash/api"
import { expensesByCategory } from "@/lib/cash/reports"

// GET /api/cash/reports/expenses-by-category?<list params, usually from&to&branch*&organization*>
// → { baseCurrency, rows: CategoryExpenseRow[] } ("Расходы по категориям"; drill-down = /api/cash/operations?expenseCategory=<id>).
export async function GET(request: Request) {
  const reader = await requireCompanyMoneyReader()
  if (reader.error) return reader.error
  const parsed = parseCashListQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await expensesByCategory(parsed.data))
}
