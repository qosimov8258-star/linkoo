import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { orderErrorResponse, routeId } from "@/lib/orders-api"
import { listOrderPayments } from "@/lib/orders-repo"
import { notSignedInResponse } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/orders/[id]/payments → OrderPaymentLine[]: "Список оплат по заказу" of the order card.
// Read from the cash ledger: the live customer payments linked to the order plus the share of the
// client's other credits allocated to it (lines add up to the card's "Оплачено").
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = routeId((await params).id)
  try {
    const lines = id ? await listOrderPayments(id) : null
    if (!lines) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
    return NextResponse.json(lines)
  } catch (error) {
    return orderErrorResponse(error)
  }
}
