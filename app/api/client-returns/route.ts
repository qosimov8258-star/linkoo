import { NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { clientReturnCreateSchema, parseClientReturnQuery } from "@/lib/client-returns-api"
import { createClientReturn, listClientReturns } from "@/lib/client-returns-repo"
import { getCurrentUser } from "@/lib/current-user"
import { orderErrorResponse } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

// GET /api/client-returns?tab=pending|accepted|cancelled|all&search&warehouse&clientId&orderId&from&to
// → { rows, totals[{currency, amount}] } (totals without cancelled returns).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const parsed = parseClientReturnQuery(request.url)
  if (parsed.error || !parsed.data) return NextResponse.json({ error: parsed.error }, { status: 400 })
  return NextResponse.json(await listClientReturns(parsed.data))
}

// POST /api/client-returns {clientId|client, warehouse, orderId?, returnDate?, items[{orderItemId|productId, quantity, price?}], full?, accept?}
// → 201 ClientReturn (pending unless accept). Only an accepted return moves stock and credits the client.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, clientReturnCreateSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await createClientReturn(parsed.data, auth.user), { status: 201 })
  } catch (error) {
    return orderErrorResponse(error)
  }
}
