import { NextResponse } from "next/server"

import { requireFieldActor } from "@/lib/field-activity/actor"
import { fieldRoute } from "@/lib/field-activity/http"
import { dayStatus } from "@/lib/field-activity/routes-repo"
import { openVisitOf } from "@/lib/field-activity/visits-repo"
import { todayIso } from "@/lib/finance/dates"

// GET /api/mobile/me — what the mobile app needs at start: the signed-in field employee, the
// open visit (if any) and today's route (planned clients in route order, which of them were
// visited, done / todo / unplanned). 403 noEmployee for an account without an employee.
export async function GET() {
  const auth = await requireFieldActor()
  if (auth.error) return auth.error
  const { actor } = auth
  return fieldRoute(async () => {
    const day = todayIso()
    const [status] = await dayStatus([actor.employee.id], day)
    const visited = new Set(status.visitedClientIds)
    return NextResponse.json({
      user: { id: actor.user.id, username: actor.user.username },
      employee: actor.employee,
      day,
      openVisit: await openVisitOf(actor.employee.id),
      route: status.planned.map((client) => ({ ...client, visited: visited.has(client.clientId) })),
      done: status.done,
      todo: status.todo,
      unplanned: status.unplanned,
    })
  })
}
