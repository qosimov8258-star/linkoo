import { NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { returnSeriesSetSchema } from "@/lib/client-returns-series-api"
import { listReturnSeries, setReturnSeries } from "@/lib/client-returns-series-repo"
import { getCurrentUser } from "@/lib/current-user"
import { orderErrorResponse, routeId } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Возврат не найден" }

// GET /api/client-returns/[id]/series — the return's «Серии» tab (Linko's sales/order_return_product_exp/?order_return=):
// [{id, returnItemId, productId, productName, amount, series: {id, number, expirationDate, displayName, …}}], newest first.
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = routeId((await params).id)
  const rows = id ? await listReturnSeries(id) : null
  if (!rows) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(rows)
}

// PUT /api/client-returns/[id]/series {products: [{amount, returnItemId, seriesId}]} — «Изменит серии» → СОХРАНИТЬ
// (Linko's order_return_product_exp/set/): the list replaces the stored one; [] clears it. Any status, like Linko.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = routeId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, returnSeriesSetSchema)
  if (parsed.error) return parsed.error
  try {
    const rows = await setReturnSeries(id, parsed.data.products, auth.user)
    if (!rows) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(rows)
  } catch (error) {
    return orderErrorResponse(error)
  }
}
