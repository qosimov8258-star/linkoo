import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { movementResponse, notFound, routeId, schemas, type RouteParams } from "@/lib/production-api"
import { autoFinishParty } from "@/lib/production-batches-repo"

/** "Автодобавление": made product + consumed components, then finish. */
export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound("Партия не найдена")
  const parsed = await parseJsonBody(request, schemas.autoFinish)
  if (parsed.error) return parsed.error
  const { recipeId, amount, comment, components } = parsed.data
  const result = await autoFinishParty(
    id,
    { recipeId, amount, comment, components: components.map(({ key, amount: norm }) => ({ kind: key.kind, id: key.id, amount: norm })) },
    auth.user.displayName,
  )
  if (result === "recipe_not_found") return notFound("Продукт этапа не найден")
  return movementResponse(result)
}
