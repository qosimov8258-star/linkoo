import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteOrderItem, updateOrderItem, type OrderItemInput } from "@/lib/order-items-repo"

type RouteParams = { params: Promise<{ id: string; itemId: string }> }

const orderItemSchema = z.object({
  productId: z.number().int().positive().optional(),
  productName: z.string().trim().min(1),
  unit: z.string().trim().min(1).max(50).optional(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  costPrice: z.number().nonnegative().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  returnQuantity: z.number().nonnegative().optional(),
})

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const { id, itemId } = await params
  const parsed = await parseJsonBody(request, orderItemSchema)
  if (parsed.error) return parsed.error

  const item = await updateOrderItem(Number(id), Number(itemId), parsed.data satisfies OrderItemInput)
  if (!item) return NextResponse.json({ error: "Позиция не найдена" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const { id, itemId } = await params
  const ok = await deleteOrderItem(Number(id), Number(itemId))
  if (!ok) return NextResponse.json({ error: "Позиция не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
