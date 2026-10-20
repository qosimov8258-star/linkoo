import { NextResponse } from "next/server"

import { returnableOfOrder } from "@/lib/client-returns-repo"
import { getCurrentUser } from "@/lib/current-user"
import { routeId } from "@/lib/orders-api"
import { getOrder } from "@/lib/orders-repo"

// GET /api/orders/[id]/returnable → per order line: ordered, already returned, still returnable, net price.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = routeId((await params).id)
  if (!id || !(await getOrder(id, { withBalances: false }))) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  return NextResponse.json(await returnableOfOrder(id))
}
