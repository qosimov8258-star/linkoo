import { NextResponse } from "next/server"

import { categoryErrorResponse } from "@/lib/categories-common"
import { categoryListQuerySchema, incomeCategoryInputSchema, searchParamsObject, wantsPagedList } from "@/lib/categories-schema"
import { getCurrentUser } from "@/lib/current-user"
import { createIncomeCategory, listIncomeCategories, listIncomeCategoriesPage } from "@/lib/income-categories-repo"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody, zodErrorResponse } from "@/lib/validation"

// GET /api/income-categories — plain array [{id, name, parameter, options, otherIncome,
// createdDate}] (id DESC) for the category selects of the other pages; optional ?search=
// and ?ordering=name. With ?page / ?pageSize (or ?paged=1) it returns the grid of the
// "Категории приходов" page instead: {count, results} filtered by ?search and ordered
// by ?ordering (default name) — demo GET finance/income_category/.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const params = new URL(request.url).searchParams
  const query = categoryListQuerySchema.safeParse(searchParamsObject(params))
  if (!query.success) return zodErrorResponse(query.error)
  if (wantsPagedList(params)) return NextResponse.json(await listIncomeCategoriesPage(query.data))
  return NextResponse.json(await listIncomeCategories(query.data.search ?? "", query.data.ordering ?? ""))
}

// POST /api/income-categories {name, option, otherIncome} — demo POST finance/income_category/
// {name, options: [id], is_other}. 400 {error, fields: {name | options}} on a duplicate name or a bad option.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, incomeCategoryInputSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createIncomeCategory(parsed.data), { status: 201 })
  } catch (error) {
    const response = categoryErrorResponse(error)
    if (response) return response
    throw error
  }
}
