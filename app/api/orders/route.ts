import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createOrder, formatOrderTimestamp, listOrders, type OrderInput } from "@/lib/orders-repo"

const orderSchema = z.object({
  client: z.string().trim().min(1),
  zone: z.string().trim().optional(),
  type: z.string().trim().optional(),
  product: z.string().trim().optional(),
  delivery: z.string().trim().optional(),
  agent: z.string().trim().optional(),
  amount: z.string().trim().optional(),
  balance: z.string().trim().optional(),
  status: z.string().trim().optional(),
  discount: z.string().trim().optional(),
  negative: z.boolean().optional(),
})

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const search = request.nextUrl.searchParams.get("q") ?? undefined
  return NextResponse.json((await listOrders(search)))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, orderSchema)
  if (parsed.error) return parsed.error

  const order = (await createOrder({ ...parsed.data, created: formatOrderTimestamp(new Date()) } satisfies Partial<OrderInput>))
  return NextResponse.json(order, { status: 201 })
}
