import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listManualDiscountPromotions, listOrderPromotions } from "@/lib/order-promotions-repo"
import { orderErrorResponse, routeId } from "@/lib/orders-api"
import { getOrder } from "@/lib/orders-repo"
import { notSignedInResponse } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Заказ не найден" }

// GET /api/orders/[id]/promotions → OrderPromotion[]: the promotions applied to the order (the card's «Задействованные
// акции», Linko's order.promotions).
// GET /api/orders/[id]/promotions?manual=true → ManualDiscountPromotion[]: what «Ручная скидка» offers for the order
// (Linko's market/promotion/get_active?order=&type=discount&discount_type=manual).
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = routeId((await params).id)
  try {
    if (!id || !(await getOrder(id, { withBalances: false }))) return NextResponse.json(NOT_FOUND, { status: 404 })
    if (new URL(request.url).searchParams.get("manual") === "true") return NextResponse.json(await listManualDiscountPromotions())
    const promotions = await listOrderPromotions(id)
    return promotions ? NextResponse.json(promotions) : NextResponse.json(NOT_FOUND, { status: 404 })
  } catch (error) {
    return orderErrorResponse(error)
  }
}
