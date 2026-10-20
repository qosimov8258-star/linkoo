import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getOrderDebtDetail } from "@/lib/finance-order-debts"
import { parseIdSegment } from "@/lib/validation"

// GET /api/order-debts/orders/[id] → OrderDebtOrderDetail (order dialog: header, parts, items).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = (parseIdSegment((await params).id) ?? 0)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  const detail = await getOrderDebtDetail(id)
  if (!detail) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  return NextResponse.json(detail)
}
