import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getOrder, updateOrder, type OrderPatch } from "@/lib/orders-repo"

type RouteParams = { params: Promise<{ id: string }> }

const STRING_FIELDS = ["client", "zone", "type", "product", "created", "delivery", "agent", "amount", "balance", "status", "discount"] as const

function parseOrderPatch(body: unknown): OrderPatch | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const patch: OrderPatch = {}

  for (const field of STRING_FIELDS) {
    if (field in value && typeof value[field] === "string") {
      patch[field] = value[field] as string
    }
  }
  if ("negative" in value && typeof value.negative === "boolean") {
    patch.negative = value.negative
  }

  return Object.keys(patch).length > 0 ? patch : null
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const order = getOrder(id)
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  return NextResponse.json(order)
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 })
  }

  const patch = parseOrderPatch(body)
  if (!patch) {
    return NextResponse.json({ error: "Нет данных для обновления" }, { status: 400 })
  }

  const order = updateOrder(id, patch)
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  return NextResponse.json(order)
}
