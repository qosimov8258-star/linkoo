import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getExpectedOrder } from "@/lib/cash/customer-payments"

// GET /api/cash/customer-payments/expected/[orderId] → ExpectedOrderDetail (header of the pay dialog).
// Paying: POST /api/cash/orders/[id]/pay (cash core).
export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = Number((await params).orderId)
  const order = Number.isInteger(id) && id > 0 ? await getExpectedOrder(id) : null
  if (!order) return NextResponse.json({ error: "Заказ не найден", field: null }, { status: 404 })
  return NextResponse.json(order)
}
