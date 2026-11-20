import { NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { orderSeriesSetSchema } from "@/lib/order-series-api"
import { listOrderSeries, setOrderSeries } from "@/lib/order-series-repo"
import { orderErrorResponse, routeId } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Заказ не найден" }

// GET /api/orders/[id]/series — the order's «Серии» tab (Linko's sales/order_product_exp/?order=):
// [{id, orderItemId, productId, productName, amount, series: {id, number, expirationDate, displayName, …}}], newest first.
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = routeId((await params).id)
  const rows = id ? await listOrderSeries(id) : null
  if (!rows) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(rows)
}

// PUT /api/orders/[id]/series {products: [{amount, orderItemId, seriesId}]} — «Изменит серии» → СОХРАНИТЬ (Linko's
// order_product_exp/set/): the list replaces the stored one; [] clears it. Any status, like Linko.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = routeId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, orderSeriesSetSchema)
  if (parsed.error) return parsed.error
  try {
    const rows = await setOrderSeries(id, parsed.data.products, auth.user)
    if (!rows) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(rows)
  } catch (error) {
    return orderErrorResponse(error)
  }
}
