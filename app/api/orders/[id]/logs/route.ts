import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { addOrderLog, listOrderLogs } from "@/lib/order-logs-repo"
import { getOrder } from "@/lib/orders-repo"

type RouteParams = { params: Promise<{ id: string }> }

const ACTIONS = ["created", "updated", "given", "cancel_given", "delivered", "undelivered", "add_discount", "add_bonus", "canceled"] as const

const logSchema = z.object({
  action: z.enum(ACTIONS),
  status: z.string().trim().max(2),
  comment: z.string().trim().max(500).optional(),
})

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listOrderLogs(Number((await params).id)))
}

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const orderId = Number((await params).id)
  const order = await getOrder(orderId)
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  const parsed = await parseJsonBody(request, logSchema)
  if (parsed.error) return parsed.error

  // the employee record that owns the login carries the person's real name (same lookup as /api/auth/me)
  const employee = (await getDb()
    .prepare("SELECT first_name, last_name FROM employees WHERE login = ? ORDER BY id LIMIT 1")
    .get(auth.user.username)) as { first_name: string; last_name: string } | undefined
  const createdBy = employee ? `${employee.first_name} ${employee.last_name}`.trim() : auth.user.displayName

  const log = await addOrderLog(orderId, {
    ...parsed.data,
    totalPrice: order.totalPrice ?? 0,
    currency: order.amount.trim().split(/\s+/).pop() || "SUM",
    payType: order.payTypeName,
    createdBy,
    market: order.marketName || order.client,
  })
  return NextResponse.json(log, { status: 201 })
}
