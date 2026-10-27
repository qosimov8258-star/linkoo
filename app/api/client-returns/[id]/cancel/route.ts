import { NextResponse } from "next/server"

import { cancelClientReturn } from "@/lib/client-returns-repo"
import { orderErrorResponse, routeId } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

// POST /api/client-returns/[id]/cancel — cancels a return. An accepted one is undone first
// (its goods leave the warehouse again, the client credit disappears; 409 when the goods are gone).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = routeId((await params).id)
  if (!id) return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
  try {
    const row = await cancelClientReturn(id, auth.user)
    if (!row) return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
    return NextResponse.json(row)
  } catch (error) {
    return orderErrorResponse(error)
  }
}
