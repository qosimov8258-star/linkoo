import { NextResponse } from "next/server"

import { acceptClientReturns } from "@/lib/client-returns-repo"
import { orderErrorResponse, routeId } from "@/lib/orders-api"
import { requirePermission } from "@/lib/rbac"

// POST /api/stock/plan/returns/[id]/accept — "Принять" of a client return in
// План приемок (tab Приемка): the return warehouse takes the goods in and the
// client is credited, exactly like POST /api/client-returns/[id]/accept. The
// warehouse keeper works this page with the stock permission (stock.manage, the
// /api/stock/** rule of lib/capabilities-catalog.ts), not with the sales one
// (orders.manage) that the returns module asks for.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("stock.manage")
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
