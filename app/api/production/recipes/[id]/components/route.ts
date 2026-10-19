import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { notFound, routeId, schemas, type RouteParams } from "@/lib/production-api"
import { addRecipeComponent } from "@/lib/production-stages-repo"

export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound()
  const parsed = await parseJsonBody(request, schemas.recipeComponent)
  if (parsed.error) return parsed.error
  const { role, key, amount } = parsed.data
  const recipe = await addRecipeComponent(id, { role, kind: key.kind, id: key.id, amount })
  return recipe ? NextResponse.json(recipe) : notFound()
}
