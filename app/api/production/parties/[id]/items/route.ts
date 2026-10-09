import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { movementResponse, notFound, routeId, schemas, type RouteParams } from "@/lib/production-api"
import { addPartyItems } from "@/lib/production-batches-repo"

/** "Добавить продукт" (made) / "Добавить сырье" (raw) for a batch. */
export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound("Партия не найдена")
  const parsed = await parseJsonBody(request, schemas.partyItems)
  if (parsed.error) return parsed.error
  const { direction, date, items } = parsed.data
  const result = await addPartyItems(id, direction, { date, items: items.map(({ key, amount }) => ({ kind: key.kind, id: key.id, amount })) }, auth.user.displayName)
  return movementResponse(result)
}
