import { NextResponse } from "next/server"

import { categoryErrorResponse } from "@/lib/categories-common"
import { categoryListQuerySchema, expenseCategoryInputSchema, searchParamsObject, wantsPagedList } from "@/lib/categories-schema"
import { getCurrentUser } from "@/lib/current-user"
import { createExpenseCategory, listExpenseCategories, listExpenseCategoriesPage } from "@/lib/expense-categories-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// GET /api/expense-categories — plain array [{id, name, parameter, options, parentId, parentName,
// direct, excludeFromPnl, createdDate}] (id DESC) for the category selects of the other pages; optional ?search=
// and ?ordering=name. With ?page / ?pageSize (or ?paged=1) it returns the grid of the
// "Категории расходов" page instead: {count, results} filtered by ?search and ordered
// by ?ordering (default name) — demo GET finance/expense_category/.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const params = new URL(request.url).searchParams
  const query = categoryListQuerySchema.safeParse(searchParamsObject(params))
  if (!query.success) return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: query.error.flatten() }, { status: 400 })
  if (wantsPagedList(params)) return NextResponse.json(await listExpenseCategoriesPage(query.data))
  return NextResponse.json(await listExpenseCategories(query.data.search ?? "", query.data.ordering ?? ""))
}

// POST /api/expense-categories {name, option, parentId, direct, excludeFromPnl} — demo POST
// finance/expense_category/ {name, parent, internal_transfer, disable_pl, options: [id]}.
// 400 {error, fields: {name | options | parentId}} on a duplicate name, a bad option or parent.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, expenseCategoryInputSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createExpenseCategory(parsed.data), { status: 201 })
  } catch (error) {
    const response = categoryErrorResponse(error)
    if (response) return response
    throw error
  }
}
