import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { routeId } from "@/lib/orders-api"
import { getOrder, listOrderLogs } from "@/lib/orders-repo"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/orders/[id]/logs → the order's change log, newest first.
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const id = routeId((await params).id)
  if (!id || !(await getOrder(id, { withBalances: false }))) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  return NextResponse.json(await listOrderLogs(id))
}
