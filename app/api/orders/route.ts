import { NextRequest, NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { orderTimeRestrictionResponse } from "@/lib/order-time-restrictions-guard"
import { orderCreateSchema, orderErrorResponse } from "@/lib/orders-api"
import { createOrder, listOrders } from "@/lib/orders-repo"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/orders[?q=][&balances=0] → Order[] (balance = the client's current
// ledger balance; balances=0 skips it for callers that do not show it).
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const search = request.nextUrl.searchParams.get("q")?.trim().slice(0, 200) || undefined
  const withBalances = request.nextUrl.searchParams.get("balances") !== "0"
  return NextResponse.json(await listOrders(search, { withBalances }))
}

// POST /api/orders {clientId|client, warehouse, currency, items[], …} → 201 Order.
// The client, warehouse, people, currency and products must exist; the total
// comes from the lines (or a validated non-negative amount without lines);
// a reserved / shipped order with lines needs enough stock (409).
export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const blocked = await orderTimeRestrictionResponse("create", auth.user)
  if (blocked) return blocked

  const parsed = await parseBody(request, orderCreateSchema)
  if (parsed.error) return parsed.error

  try {
    const { balance: _balance, negative: _negative, ...input } = parsed.data
    void _balance
    void _negative
    const order = await createOrder(input, auth.user)
    return NextResponse.json(order, { status: 201 })
  } catch (error) {
    return orderErrorResponse(error)
  }
}
