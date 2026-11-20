import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { guarded, notFound, parseBody, routeId, type RouteParams } from "@/lib/production-api"
import { closeSession } from "@/lib/production-sessions-repo"
import { sessionCloseSchema } from "@/lib/production-sessions-schemas"

/** POST {closedAt?} — «Закрыть смену» of an open session (default now). 200 → the session. */
export async function POST(request: Request, context: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound("Смена не найдена")
  const parsed = await parseBody(request, sessionCloseSchema)
  if (parsed.error) return parsed.error
  return guarded(async () => {
    const session = await closeSession(id, parsed.data, auth.user.displayName)
    if (session === "not_found") return notFound("Смена не найдена")
    return NextResponse.json(session)
  })
}
