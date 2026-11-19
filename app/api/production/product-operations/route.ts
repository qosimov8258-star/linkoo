import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { guarded, parseBody, schemas } from "@/lib/production-api"
import { attachRecipeOperations } from "@/lib/production-stages-repo"

/** «Прикрепить операцию» (the reference's POST /manufacture/product_operations/ {operations, products}):
 * attaches every operation to every selected stage product → 200 { attached } (pairs attached already are kept);
 * an unknown product or operation → 404. */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, schemas.productOperations)
  if (parsed.error) return parsed.error
  return guarded(async () => NextResponse.json({ attached: await attachRecipeOperations(parsed.data.recipeIds, parsed.data.operationIds) }))
}
