import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getOrderDebtDetail } from "@/lib/finance-order-debts"
import { notSignedInResponse, parseIdSegment } from "@/lib/validation"

// GET /api/order-debts/orders/[id] → OrderDebtOrderDetail (order dialog: header, parts, items). With ?optional=1 an
// order outside the debts model answers null instead of 404 (the order dialog then uses the cash core's numbers).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = (parseIdSegment((await params).id) ?? 0)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  const detail = await getOrderDebtDetail(id)
  if (!detail && new URL(request.url).searchParams.get("optional") === "1") return NextResponse.json(null)
  if (!detail) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  return NextResponse.json(detail)
}
