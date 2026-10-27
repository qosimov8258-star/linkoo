import { NextRequest, NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { orderErrorResponse, orderPatchSchema as baseOrderPatchSchema, routeId } from "@/lib/orders-api"
import { deleteOrder, getOrder, getOrderClientDebt, updateOrder } from "@/lib/orders-repo"
import { requireRole } from "@/lib/rbac"
import { z } from "zod"

import { getDb } from "@/lib/db"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Заказ не найден" }

const isoDay = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")])

// The shared patch schema plus the reference-snapshot fields the order card edits.
const orderPatchSchema = baseOrderPatchSchema.extend({
  expeditor: z.string().trim().max(200).optional(),
  payMethod: z.enum(["cash", "bank", ""]).optional(),
  payTypeName: z.string().trim().max(100).optional(),
  stockName: z.string().trim().max(200).optional(),
  branchName: z.string().trim().max(200).optional(),
  transportNumber: z.string().trim().max(100).optional(),
  dueDate: isoDay.optional(),
  acceptedDate: isoDay.optional(),
  paidAmount: z.number().min(0).optional(),
  orderBalance: z.number().optional(),
  invoiceContract: z.string().trim().max(200).optional(),
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/).optional(),
})

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

/** Removes an order that never left the warehouse (the reference only cancels, so a shipped / delivered order is refused). */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Noto'g'ri id" }, { status: 400 })
  const order = await getOrder(id)
  if (!order) return NextResponse.json({ error: "Topilmadi" }, { status: 404 })
  if (order.status === "В пути" || order.status === "Доставлено") {
    return NextResponse.json({ error: "Отгруженный или доставленный заказ нельзя удалить, его можно только отменить" }, { status: 409 })
  }
  const db = getDb()
  await db.prepare("DELETE FROM order_items WHERE order_id = ?").run(id)
  await db.prepare("DELETE FROM order_logs WHERE order_id = ?").run(id)
  // Return documents made for this order feed P&L and the balances: they go with the order.
  await db.prepare("DELETE FROM customer_returns WHERE order_id = ?").run(id)
  await deleteOrder(id)
  return new NextResponse(null, { status: 204 })
}
