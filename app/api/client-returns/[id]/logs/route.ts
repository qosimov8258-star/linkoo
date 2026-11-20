import { NextResponse } from "next/server"

import { listClientReturnLogs } from "@/lib/client-return-logs-repo"
import { getClientReturn } from "@/lib/client-returns-repo"
import { getCurrentUser } from "@/lib/current-user"
import { routeId } from "@/lib/orders-api"

// GET /api/client-returns/[id]/logs — the return card's «Логи» (Linko's sales/order_return_logs/?order_return=<id>):
// [{id, action, status, totalPrice, currency, comment, createdBy, createdAt}] in Linko's order.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = routeId((await params).id)
  // getClientReturn also makes sure the returns' tables (and the log table) exist.
  if (!id || !(await getClientReturn(id))) return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
  return NextResponse.json(await listClientReturnLogs(id))
}
