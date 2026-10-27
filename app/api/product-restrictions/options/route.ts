import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listRestrictionOptions, productRestrictionErrorResponse } from "@/lib/product-restrictions-repo"
import { parseRestrictionOptionsQuery } from "@/lib/product-restrictions-schema"
import { invalidFieldResponse, notSignedInResponse } from "@/lib/validation"

// GET /api/product-restrictions/options?kind=product|product_type&search=&page=1&pageSize=50
//   &type=<productTypeId>&brand=<brandId>&organization=<organizationId>   (filters: products only)
// → {count, page, pageSize, results: [{id, name}]}: the picker "Добавление продуктов" — live
// products, or product types ("Parent / Child"), by name. Unknown filter ids → 400. Any signed-in user.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseRestrictionOptionsQuery(new URL(request.url).searchParams)
  if ("error" in parsed) return invalidFieldResponse(parsed.field, parsed.error, parsed.error)
  try {
    return NextResponse.json(await listRestrictionOptions(parsed.query))
  } catch (error) {
    const response = productRestrictionErrorResponse(error)
    if (response) return response
    throw error
  }
}
