import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { guarded, notFound, parseBody, schemas, type RouteParams } from "@/lib/production-api"
import { deleteRecipe, updateRecipe } from "@/lib/production-stages-repo"
import { parseIdSegment } from "@/lib/validation"

export async function PUT(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound()
  const parsed = await parseBody(request, schemas.recipeUpdate)
  if (parsed.error) return parsed.error
  return guarded(async () => {
    const recipe = await updateRecipe(id, parsed.data)
    return recipe ? NextResponse.json(recipe) : notFound()
  })
}

export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id || !(await deleteRecipe(id))) return notFound()
  return NextResponse.json({ ok: true })
}
