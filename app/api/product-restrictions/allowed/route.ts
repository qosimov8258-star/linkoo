import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { allowedProducts, productRestrictionErrorResponse } from "@/lib/product-restrictions-repo"
import { parseAllowedQuery } from "@/lib/product-restrictions-schema"
import { invalidFieldResponse, notSignedInResponse } from "@/lib/validation"

// GET /api/product-restrictions/allowed?employeeId=<id> | ?agent=<"First Last"> | (neither: the
// caller's own employee, Права доступа → Пользователи link)
// → {employeeId, name, restricted, productIds, productTypeIds, allowedProductIds}
// What the employee may sell, for the mobile agent app's catalogue and the order forms:
// restricted = false → every product (allowedProductIds null); else only allowedProductIds
// (live products of the product list or of a type in the type list). 400 when no employee is
// given and the account has none; 404 for an unknown one. Any signed-in user (read only).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseAllowedQuery(new URL(request.url).searchParams)
  if ("error" in parsed) return invalidFieldResponse(parsed.field, parsed.error, parsed.error)
  try {
    return NextResponse.json(await allowedProducts(parsed.query, user.employeeId))
  } catch (error) {
    const response = productRestrictionErrorResponse(error)
    if (response) return response
    throw error
  }
}
