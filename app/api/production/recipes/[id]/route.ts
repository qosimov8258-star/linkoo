import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { notFound, routeId, schemas, type RouteParams } from "@/lib/production-api"
import { deleteRecipe, updateRecipe } from "@/lib/production-stages-repo"

export async function PUT(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound()
  const parsed = await parseJsonBody(request, schemas.recipeUpdate)
  if (parsed.error) return parsed.error
  const recipe = await updateRecipe(id, parsed.data)
  return recipe ? NextResponse.json(recipe) : notFound()
}

export async function DELETE(_request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id || !(await deleteRecipe(id))) return notFound()
  return NextResponse.json({ ok: true })
}
