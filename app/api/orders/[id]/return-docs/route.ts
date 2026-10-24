import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listOrderReturnDocs } from "@/lib/order-return-docs-repo"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/orders/[id]/return-docs — the "Возврат" tab of the order card (demo GET sales/order_return/?order=).
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listOrderReturnDocs(Number((await params).id)))
}
