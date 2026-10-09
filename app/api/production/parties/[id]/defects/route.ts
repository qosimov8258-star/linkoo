import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { movementResponse, notFound, routeId, schemas, type RouteParams } from "@/lib/production-api"
import { addPartyDefect } from "@/lib/production-batches-repo"

export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound("Партия не найдена")
  const parsed = await parseJsonBody(request, schemas.defect)
  if (parsed.error) return parsed.error
  const { type, key, amount, comment, image } = parsed.data
  return movementResponse(await addPartyDefect(id, { type, kind: key.kind, id: key.id, amount, comment, image }, auth.user.displayName))
}
