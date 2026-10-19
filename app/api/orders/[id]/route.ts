import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { getOrder, updateOrder, type OrderPatch } from "@/lib/orders-repo"

type RouteParams = { params: Promise<{ id: string }> }

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
})

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

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

  const order = (await updateOrder(id, patch))
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  return NextResponse.json(order)
}
