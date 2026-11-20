import { requireRole } from "@/lib/rbac"
import { guarded, movementResponse, notFound, parseBody, schemas, type RouteParams } from "@/lib/production-api"
import { autoFinishParty } from "@/lib/production-batches-repo"
import { parseIdSegment } from "@/lib/validation"

/** "Автодобавление": the product made and its amount; the server books the raw materials its norm consumes for that
 * amount (like the reference, the client sends no components), then finishes the batch. */
export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound("Партия не найдена")
  const parsed = await parseBody(request, schemas.autoFinish)
  if (parsed.error) return parsed.error
  const { recipeId, amount, comment } = parsed.data
  return guarded(async () => {
    const result = await autoFinishParty(id, { recipeId, amount, comment }, auth.user.displayName)
    if (result === "recipe_not_found") return notFound("Продукт этапа не найден")
    return movementResponse(result)
  })
}
