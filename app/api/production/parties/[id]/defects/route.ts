import { requireRole } from "@/lib/rbac"
import { guarded, movementResponse, notFound, parseBody, schemas, type RouteParams } from "@/lib/production-api"
import { addPartyDefect } from "@/lib/production-batches-repo"
import { parseIdSegment } from "@/lib/validation"

export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await context.params).id)
  if (!id) return notFound("Партия не найдена")
  const parsed = await parseBody(request, schemas.defect)
  if (parsed.error) return parsed.error
  const { type, key, amount, comment, image } = parsed.data
  return guarded(async () => movementResponse(await addPartyDefect(id, { type, kind: key.kind, id: key.id, amount, comment, image }, auth.user.displayName)))
}
