import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { guarded, notFound, type RouteParams } from "@/lib/production-api"
import { detachRecipeOperation } from "@/lib/production-stages-repo"
import { parseIdSegment } from "@/lib/validation"

/** Detaches one operation from its stage product → the product's refreshed norm. */
export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound()
  return guarded(async () => {
    const recipe = await detachRecipeOperation(id)
    return recipe ? NextResponse.json(recipe) : notFound()
  })
}
