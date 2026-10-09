import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getOrderDue } from "@/lib/cash/expected-payments"

// GET /api/cash/orders/[id] → OrderDue (client, status, total / paid / remaining per currency).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = Number((await params).id)
  const due = Number.isInteger(id) && id > 0 ? await getOrderDue(id) : null
  if (!due) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  return NextResponse.json(due)
}
