import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listOrderSeriesLines } from "@/lib/order-series-repo"
import { routeId } from "@/lib/orders-api"

// GET /api/orders/[id]/series-lines?search= — «Наименование» of «Изменит серии»: the order's lines whose product keeps
// an expiry (Linko's sales/order_product/?order=&use_expiration=true), one per line:
// [{id, productId, productName, quantity, unit, isBonus}].
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = routeId((await params).id)
  const search = (new URL(request.url).searchParams.get("search") ?? "").slice(0, 200)
  const rows = id ? await listOrderSeriesLines(id, search) : null
  if (!rows) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  return NextResponse.json(rows)
}
