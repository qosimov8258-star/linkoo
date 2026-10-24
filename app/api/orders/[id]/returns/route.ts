import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { createCustomerReturn, listCustomerReturns } from "@/lib/customer-returns-repo"
import { getDb } from "@/lib/db"
import { getOrder } from "@/lib/orders-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const returnSchema = z.object({
  comment: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        productName: z.string().trim().min(1),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        discountPercent: z.number().min(0).max(100).optional(),
        currency: z.string().trim().min(1).max(10).optional(),
      }),
    )
    .min(1),
})

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listCustomerReturns(Number((await params).id)))
}

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const orderId = Number((await params).id)
  if (!(await getOrder(orderId))) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  const parsed = await parseJsonBody(request, returnSchema)
  if (parsed.error) return parsed.error

  const employee = (await getDb()
    .prepare("SELECT first_name, last_name FROM employees WHERE login = ? ORDER BY id LIMIT 1")
    .get(auth.user.username)) as { first_name: string; last_name: string } | undefined
  const createdBy = employee ? `${employee.first_name} ${employee.last_name}`.trim() : auth.user.displayName
  const created = await createCustomerReturn(orderId, parsed.data.lines, { comment: parsed.data.comment ?? "", createdBy })
  return NextResponse.json(created, { status: 201 })
}
