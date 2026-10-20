import { NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { createOrderItem, listOrderItems } from "@/lib/order-items-repo"
import { orderErrorResponse, orderLineSchema, routeId } from "@/lib/orders-api"
import { getOrder } from "@/lib/orders-repo"
import { requireRole } from "@/lib/rbac"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Заказ не найден" }

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const orderId = routeId((await params).id)
  if (!orderId || !(await getOrder(orderId, { withBalances: false }))) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(await listOrderItems(orderId))
}

// POST /api/orders/[id]/items {productId, quantity, unitPrice, …} — 404 for an
// unknown order, 409 when the order is no longer editable or stock is short,
// 400 for a product that is not in the catalog / not for sale or another currency.
export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const orderId = routeId((await params).id)
  if (!orderId) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, orderLineSchema)
  if (parsed.error) return parsed.error

  try {
    const item = await createOrderItem(orderId, parsed.data, auth.user)
    return NextResponse.json(item, { status: 201 })
  } catch (error) {
    return orderErrorResponse(error)
  }
}
