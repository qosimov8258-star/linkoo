import { requireRole } from "@/lib/rbac"
import { guarded, movementResponse, notFound, parseBody, schemas, type RouteParams } from "@/lib/production-api"
import { addPartyItems } from "@/lib/production-batches-repo"
import { parseIdSegment } from "@/lib/validation"

/** "Добавить продукт" (made) / "Добавить сырье" (raw) for a batch. */
export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound("Партия не найдена")
  const parsed = await parseBody(request, schemas.partyItems)
  if (parsed.error) return parsed.error
  const { direction, date, items } = parsed.data
  return guarded(async () =>
    movementResponse(await addPartyItems(id, direction, { date, items: items.map(({ key, amount }) => ({ kind: key.kind, id: key.id, amount })) }, auth.user.displayName)),
  )
}
