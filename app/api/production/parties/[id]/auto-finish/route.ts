import { requireRole } from "@/lib/rbac"
import { guarded, movementResponse, notFound, parseBody, schemas, type RouteParams } from "@/lib/production-api"
import { autoFinishParty } from "@/lib/production-batches-repo"
import { parseIdSegment } from "@/lib/validation"

/** "Автодобавление": made product + consumed components, then finish. */
export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound("Партия не найдена")
  const parsed = await parseBody(request, schemas.autoFinish)
  if (parsed.error) return parsed.error
  const { recipeId, amount, comment, components } = parsed.data
  return guarded(async () => {
    const result = await autoFinishParty(
      id,
      { recipeId, amount, comment, components: components.map(({ key, amount: norm }) => ({ kind: key.kind, id: key.id, amount: norm })) },
      auth.user.displayName,
    )
    if (result === "recipe_not_found") return notFound("Продукт этапа не найден")
    return movementResponse(result)
  })
}
