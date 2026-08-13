import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createOrder, formatOrderTimestamp, listOrders, type OrderInput } from "@/lib/orders-repo"

function parseOrderInput(body: unknown): Partial<OrderInput> | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>

  const client = typeof value.client === "string" ? value.client.trim() : ""
  if (!client) return null

  const str = (key: string) => (typeof value[key] === "string" ? (value[key] as string).trim() : undefined)

  return {
    client,
    zone: str("zone"),
    type: str("type"),
    product: str("product"),
    delivery: str("delivery"),
    agent: str("agent"),
    amount: str("amount"),
    balance: str("balance"),
    status: str("status"),
    discount: str("discount"),
    negative: typeof value.negative === "boolean" ? value.negative : undefined,
    created: formatOrderTimestamp(new Date()),
  }
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const search = request.nextUrl.searchParams.get("q") ?? undefined
  return NextResponse.json(listOrders(search))
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 })
  }

  const input = parseOrderInput(body)
  if (!input) {
    return NextResponse.json({ error: "Клиент обязателен" }, { status: 400 })
  }

  const order = createOrder(input)
  return NextResponse.json(order, { status: 201 })
}
