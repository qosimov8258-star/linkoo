import { NextResponse } from "next/server"

import { acceptClientReturns } from "@/lib/client-returns-repo"
import { orderErrorResponse, routeId } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

// POST /api/client-returns/[id]/accept — "Принять на склад": stock comes in, the client is credited.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = routeId((await params).id)
  if (!id) return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
  try {
    const [row] = await acceptClientReturns([id], auth.user)
    return NextResponse.json(row)
  } catch (error) {
    return orderErrorResponse(error)
  }
}
