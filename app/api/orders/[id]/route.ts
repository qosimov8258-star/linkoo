import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { getDb } from "@/lib/db"
import { addOrderLog } from "@/lib/order-logs-repo"
import { deleteOrder, getOrder, updateOrder, type OrderPatch } from "@/lib/orders-repo"

type RouteParams = { params: Promise<{ id: string }> }

/** Reference status codes (0 В процессе … 5 Не подтвержден) and the labels its log comments use. */
const STATUS_CODE: Record<string, string> = { "В процессе": "0", "Есть на складе": "1", "В пути": "2", "Доставлено": "3", "Отменен": "4", "Не подтвержден": "5" }
const STATUS_LOG_LABEL: Record<string, string> = { "В пути": "Передан доставщику", "Доставлено": "Доставлен" }
const statusLogLabel = (status: string) => STATUS_LOG_LABEL[status] ?? status

const orderPatchSchema = z.object({
  client: z.string().optional(),
  zone: z.string().optional(),
  type: z.string().optional(),
  product: z.string().optional(),
  created: z.string().optional(),
  delivery: z.string().optional(),
  agent: z.string().optional(),
  amount: z.string().optional(),
  balance: z.string().optional(),
  status: z.string().optional(),
  discount: z.string().optional(),
  negative: z.boolean().optional(),
  paymentDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
  paymentType: z.enum(["cash", "bank", ""]).optional(),
  organization: z.string().trim().max(200).optional(),
  deliveryMan: z.string().trim().max(200).optional(),
  expeditor: z.string().trim().max(200).optional(),
  payMethod: z.enum(["cash", "bank", ""]).optional(),
  payTypeName: z.string().trim().max(100).optional(),
  priceList: z.string().trim().max(200).optional(),
  stockName: z.string().trim().max(200).optional(),
  branchName: z.string().trim().max(200).optional(),
  dealType: z.enum(["0", "1", ""]).optional(),
  deliveryType: z.enum(["delivery", "self", ""]).optional(),
  dueDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
  transportNumber: z.string().trim().max(100).optional(),
  acceptedDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
  paidAmount: z.number().min(0).optional(),
  orderBalance: z.number().optional(),
  invoiceActive: z.boolean().optional(),
  invoiceNumber: z.string().trim().max(100).optional(),
  invoiceDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal("")]).optional(),
  invoiceContract: z.string().trim().max(200).optional(),
  createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/).optional(),
})

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const order = (await getOrder(id))
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  return NextResponse.json(order)
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, orderPatchSchema)
  if (parsed.error) return parsed.error

  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined)) as OrderPatch
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Нет данных для обновления" }, { status: 400 })
  }

  const before = await getOrder(id)
  const order = (await updateOrder(id, patch))
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  if (before && order.status !== before.status) {
    // the employee record that owns the login carries the person's real name (same lookup as /api/auth/me)
    const employee = (await getDb()
      .prepare("SELECT first_name, last_name FROM employees WHERE login = ? ORDER BY id LIMIT 1")
      .get(auth.user.username)) as { first_name: string; last_name: string } | undefined
    await addOrderLog(id, {
      action: "updated",
      status: STATUS_CODE[order.status] ?? "",
      comment: `Изменен статус: ${statusLogLabel(before.status)} - ${statusLogLabel(order.status)}`,
      totalPrice: order.totalPrice ?? 0,
      currency: order.amount.trim().split(/\s+/).pop() || "SUM",
      payType: order.payTypeName,
      createdBy: employee ? `${employee.first_name} ${employee.last_name}`.trim() : auth.user.displayName,
      market: order.marketName || order.client,
    })
  }
  return NextResponse.json(order)
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
