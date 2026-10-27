import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { productRestrictionErrorResponse, restrictionFilters } from "@/lib/product-restrictions-repo"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/product-restrictions/filters → {types, brands, organizations: [{id, name}]}: the
// picker's "Фильтр по типу / бренду / организации" lists. Any signed-in user.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  try {
    return NextResponse.json(await restrictionFilters())
  } catch (error) {
    const response = productRestrictionErrorResponse(error)
    if (response) return response
    throw error
  }
}
