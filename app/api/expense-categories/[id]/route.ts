import { NextResponse } from "next/server"

import { categoryErrorResponse } from "@/lib/categories-common"
import { expenseCategoryInputSchema, parseCategoryId } from "@/lib/categories-schema"
import { getCurrentUser } from "@/lib/current-user"
import { deleteExpenseCategory, getExpenseCategoryDetail, updateExpenseCategory } from "@/lib/expense-categories-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Категория не найдена" }

// GET /api/expense-categories/[id] — demo GET finance/expense_category/:id/; ?usage=1 adds where it is used.
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = parseCategoryId((await params).id)
  const withUsage = new URL(request.url).searchParams.get("usage") === "1"
  const category = id ? await getExpenseCategoryDetail(id, withUsage) : null
  if (!category) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(category)
}

// PUT /api/expense-categories/[id] {name, option, parentId, direct, excludeFromPnl} — the parent
// may not be the category or one of its descendants; a rename is copied to the money rows
// linked to the category (see lib/categories-common.ts).
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseCategoryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, expenseCategoryInputSchema)
  if (parsed.error) return parsed.error

  try {
    const category = await updateExpenseCategory(id, parsed.data)
    if (!category) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(category)
  } catch (error) {
    const response = categoryErrorResponse(error)
    if (response) return response
    throw error
  }
}

// DELETE /api/expense-categories/[id] — 409 {error: "Удаление невозможно из-за связи с другими
// данными", usage} while money rows or child categories reference the category.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseCategoryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const ok = await deleteExpenseCategory(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const response = categoryErrorResponse(error)
    if (response) return response
    throw error
  }
}
