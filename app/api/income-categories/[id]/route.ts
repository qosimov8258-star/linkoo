import { NextResponse } from "next/server"

import { categoryErrorResponse } from "@/lib/categories-common"
import { incomeCategoryInputSchema, parseCategoryId } from "@/lib/categories-schema"
import { getCurrentUser } from "@/lib/current-user"
import { deleteIncomeCategory, getIncomeCategoryDetail, updateIncomeCategory } from "@/lib/income-categories-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Категория не найдена" }

// GET /api/income-categories/[id] — demo GET finance/income_category/:id/; ?usage=1 adds where it is used.
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = parseCategoryId((await params).id)
  const withUsage = new URL(request.url).searchParams.get("usage") === "1"
  const category = id ? await getIncomeCategoryDetail(id, withUsage) : null
  if (!category) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(category)
}

// PUT /api/income-categories/[id] {name, option, otherIncome} — a rename is copied to the
// money rows linked to the category (see lib/categories-common.ts).
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseCategoryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, incomeCategoryInputSchema)
  if (parsed.error) return parsed.error

  try {
    const category = await updateIncomeCategory(id, parsed.data)
    if (!category) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(category)
  } catch (error) {
    const response = categoryErrorResponse(error)
    if (response) return response
    throw error
  }
}

// DELETE /api/income-categories/[id] — 409 {error: "Удаление невозможно из-за связи с другими
// данными", usage} while money rows reference the category.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseCategoryId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const ok = await deleteIncomeCategory(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const response = categoryErrorResponse(error)
    if (response) return response
    throw error
  }
}
