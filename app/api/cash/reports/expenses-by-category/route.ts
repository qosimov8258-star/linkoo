import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseCashListQuery } from "@/lib/cash/api"
import { expensesByCategory } from "@/lib/cash/reports"

// GET /api/cash/reports/expenses-by-category?<list params, usually from&to&branch*&organization*>
// → { baseCurrency, rows: CategoryExpenseRow[] } ("Расходы по категориям"; drill-down = /api/cash/operations?expenseCategory=<id>).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseCashListQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await expensesByCategory(parsed.data))
}
