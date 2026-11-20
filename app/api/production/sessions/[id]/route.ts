import { NextResponse } from "next/server"

import { guarded, notFound, requireViewer, routeId, type RouteParams } from "@/lib/production-api"
import { getSession } from "@/lib/production-sessions-repo"

/** GET — one shift session (Linko's staff/personal_rotation/<id>/): «Передать на склад» opened from the address
 * (openShift=<id>) for a session that is not on the shown page. 404 when there is none. */
export async function GET(_request: Request, context: RouteParams) {
  const denied = await requireViewer()
  if (denied) return denied
  const id = await routeId(context)
  if (!id) return notFound("Смена не найдена")
  return guarded(async () => {
    const session = await getSession(id)
    return session ? NextResponse.json(session) : notFound("Смена не найдена")
  })
}
