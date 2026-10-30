import { NextResponse } from "next/server"

import { listClientReturns } from "@/lib/client-returns-repo"
import { getCurrentUser } from "@/lib/current-user"
import { orderErrorResponse, routeId } from "@/lib/orders-api"
import { getOrder } from "@/lib/orders-repo"
import { notSignedInResponse } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

/** A return document of the order (Продажи → Возвраты, client_returns). */
type OrderReturnDoc = {
  id: number
  /** The return's comment (the reason the client gave). */
  reason: string
  warehouse: string
  /** "YYYY-MM-DD". */
  date: string
  amount: number
  currency: string
  status: "pending" | "accepted" | "cancelled"
}

// GET /api/orders/[id]/return-docs → OrderReturnDoc[], newest first: the client returns of the
// order (lib/client-returns-repo.ts), the same documents as Продажи → Возвраты.
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = routeId((await params).id)
  try {
    if (!id || !(await getOrder(id, { withBalances: false }))) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
    const { rows } = await listClientReturns({ orderId: id, tab: "all" })
    const docs: OrderReturnDoc[] = rows.map((row) => ({
      id: row.id,
      reason: row.comment,
      warehouse: row.warehouse,
      date: row.returnDate,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
    }))
    return NextResponse.json(docs)
  } catch (error) {
    return orderErrorResponse(error)
  }
}
