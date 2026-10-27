import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { guarded, notFound, parseBody, schemas, type RouteParams } from "@/lib/production-api"
import { addRecipeComponent } from "@/lib/production-stages-repo"
import { parseIdSegment } from "@/lib/validation"

export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound("Продукт этапа не найден")
  const parsed = await parseBody(request, schemas.recipeComponent)
  if (parsed.error) return parsed.error
  const { role, key, amount } = parsed.data
  return guarded(async () => {
    const recipe = await addRecipeComponent(id, { role, kind: key.kind, id: key.id, amount })
    return recipe ? NextResponse.json(recipe) : notFound("Продукт этапа не найден")
  })
}
