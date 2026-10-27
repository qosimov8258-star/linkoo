import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { applyProductRestrictions, listRestrictionEmployees, productRestrictionErrorResponse } from "@/lib/product-restrictions-repo"
import { parseRestrictionListQuery, restrictionApplySchema } from "@/lib/product-restrictions-schema"
import { requireRole } from "@/lib/rbac"
import { invalidFieldResponse, notSignedInResponse, parseJsonBody } from "@/lib/validation"

// GET /api/product-restrictions?tab=product|product_type&search=&page=1&pageSize=25&ordering=id|-id
// → {count, page, pageSize, results: [{id, name, active, productCount, productTypeCount}]}: the
// active employees (and inactive ones that still have a list), by id. Any signed-in user.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseRestrictionListQuery(new URL(request.url).searchParams)
  if ("error" in parsed) return invalidFieldResponse(parsed.field, parsed.error, parsed.error)
  try {
    return NextResponse.json(await listRestrictionEmployees(parsed.query))
  } catch (error) {
    const response = productRestrictionErrorResponse(error)
    if (response) return response
    throw error
  }
}

// POST /api/product-restrictions {mode: add|remove|set, tab: product|product_type, employeeIds: [id…], itemIds: [id…]}
// → {employees, changed}. ADD = union, REMOVE = subtract, SET = replace (no items: clear). Unknown
// employees / products / types and deleted products (ADD, SET) → 400 with `items`. Manager + catalog.manage.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, restrictionApplySchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await applyProductRestrictions(parsed.data))
  } catch (error) {
    const response = productRestrictionErrorResponse(error)
    if (response) return response
    throw error
  }
}
