import { NextRequest, NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { orderErrorResponse, orderPatchSchema, routeId } from "@/lib/orders-api"
import { getOrder, getOrderClientDebt, updateOrder } from "@/lib/orders-repo"
import { requireRole } from "@/lib/rbac"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Заказ не найден" }

// GET /api/orders/[id] → Order + clientDebt {operative, actual} (the client's ledger balance by creation / realization).
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = routeId((await params).id)
  const order = id ? await getOrder(id) : null
  if (!order) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json({ ...order, clientDebt: await getOrderClientDebt(order) })
}

// PATCH /api/orders/[id] — status (known statuses and allowed transitions only,
// 409 otherwise), client, warehouse, people, payment terms… Доставлено /
// Отменен orders are final (only payment date / invoice details change).
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = routeId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, orderPatchSchema)
  if (parsed.error) return parsed.error

  const { balance: _balance, negative: _negative, ...patch } = parsed.data
  void _balance
  void _negative
  if (!Object.values(patch).some((value) => value !== undefined)) {
    return NextResponse.json({ error: "Нет данных для обновления" }, { status: 400 })
  }

  try {
    const order = await updateOrder(id, patch, auth.user)
    if (!order) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(order)
  } catch (error) {
    return orderErrorResponse(error)
  }
}
