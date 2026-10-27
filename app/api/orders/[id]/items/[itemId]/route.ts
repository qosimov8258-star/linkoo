import { NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { deleteOrderItem, updateOrderItem } from "@/lib/order-items-repo"
import { orderTimeRestrictionResponse } from "@/lib/order-time-restrictions-guard"
import { orderErrorResponse, orderLineSchema, routeId } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

type RouteParams = { params: Promise<{ id: string; itemId: string }> }

const ITEM_NOT_FOUND = { error: "Позиция не найдена" }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const blocked = await orderTimeRestrictionResponse("edit", auth.user)
  if (blocked) return blocked

  const { id, itemId } = await params
  const orderId = routeId(id)
  const lineId = routeId(itemId)
  if (!orderId) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  if (!lineId) return NextResponse.json(ITEM_NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, orderLineSchema)
  if (parsed.error) return parsed.error

  try {
    const item = await updateOrderItem(orderId, lineId, parsed.data, auth.user)
    if (!item) return NextResponse.json(ITEM_NOT_FOUND, { status: 404 })
    return NextResponse.json(item)
  } catch (error) {
    return orderErrorResponse(error)
  }
}

// DELETE — the last line too: the order total then becomes 0.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const blocked = await orderTimeRestrictionResponse("edit", auth.user)
  if (blocked) return blocked

  const { id, itemId } = await params
  const orderId = routeId(id)
  const lineId = routeId(itemId)
  if (!orderId) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  if (!lineId) return NextResponse.json(ITEM_NOT_FOUND, { status: 404 })

  try {
    const ok = await deleteOrderItem(orderId, lineId, auth.user)
    if (!ok) return NextResponse.json(ITEM_NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return orderErrorResponse(error)
  }
}
