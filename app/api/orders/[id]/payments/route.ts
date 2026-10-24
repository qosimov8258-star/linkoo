import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listOrderPayments } from "@/lib/order-return-docs-repo"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/orders/[id]/payments — "Список оплат по заказу" (demo GET sales/debt_transactions/?order=).
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listOrderPayments(Number((await params).id)))
}
