import { NextResponse } from "next/server"

import { requirePermission } from "@/lib/rbac"
import { guarded, notFound, parseBody, routeId, type RouteParams } from "@/lib/production-api"
import { handOverSession } from "@/lib/production-sessions-repo"
import { sessionGiveSchema } from "@/lib/production-sessions-schemas"

/** POST {warehouseId} — «Передать на склад» (Linko's POST staff/personal_rotation/<id>/give/ {stock}): the session's
 * output leaves for the warehouse as an «Отгрузка» (Склад → План приемок и передач). It moves stock, so besides the
 * production right of /api/production (lib/capabilities-catalog.ts) it needs the stock one. 200 → the session. */
export async function POST(request: Request, context: RouteParams) {
  const auth = await requirePermission("stock.manage")
  if ("error" in auth) return auth.error
  const id = await routeId(context)
  if (!id) return notFound("Смена не найдена")
  const parsed = await parseBody(request, sessionGiveSchema)
  if (parsed.error) return parsed.error
  return guarded(async () => {
    const session = await handOverSession(id, parsed.data.warehouseId, auth.user.displayName)
    if (session === "not_found") return notFound("Смена не найдена")
    return NextResponse.json(session)
  })
}
