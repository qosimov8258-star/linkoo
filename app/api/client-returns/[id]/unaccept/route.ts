import { NextResponse } from "next/server"

import { unacceptClientReturn } from "@/lib/client-returns-repo"
import { orderErrorResponse, routeId } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

// POST /api/client-returns/[id]/unaccept — "Отменить приемку": an accepted return goes back to
// pending; its goods leave the warehouse again and the client credit disappears. 409 when the
// warehouse no longer holds the goods (on any day from the acceptance on) or an inventory counted them.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = routeId((await params).id)
  if (!id) return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
  try {
    const row = await unacceptClientReturn(id, auth.user)
    if (!row) return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
    return NextResponse.json(row)
  } catch (error) {
    return orderErrorResponse(error)
  }
}
