import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createOrderItem, listOrderItems, type OrderItemInput } from "@/lib/order-items-repo"

type RouteParams = { params: Promise<{ id: string }> }

const orderItemSchema = z.object({
  productId: z.number().int().positive().optional(),
  productName: z.string().trim().min(1),
  unit: z.string().trim().min(1).max(50).optional(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  costPrice: z.number().nonnegative().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  currency: z.string().trim().min(1).max(10).optional(),
})

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const orderId = Number((await params).id)
  return NextResponse.json(await listOrderItems(orderId))
}

export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const orderId = Number((await params).id)
  const parsed = await parseJsonBody(request, orderItemSchema)
  if (parsed.error) return parsed.error

  const item = await createOrderItem(orderId, parsed.data satisfies OrderItemInput)
  return NextResponse.json(item, { status: 201 })
}
