import { NextResponse } from "next/server"

import { movementFailure, movementRequest, stockMovementItem } from "@/lib/stock-movement-report"

// GET /api/stock/movement/item?key=product:12&from&to&warehouse*&branch*&mode&priceList
// → MoveItemDetail: the item's begin / kinds / end per warehouse, the total and
// the period's source documents (newest first, at most 500).
export async function GET(request: Request) {
  const parsed = await movementRequest(request.url)
  if (parsed.error) return parsed.error
  const key = (parsed.params.get("key") ?? "").trim()
  if (!key) return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: { fieldErrors: { key: ["required"] } } }, { status: 400 })
  try {
    const detail = await stockMovementItem(key, parsed.filters)
    if (!detail) return NextResponse.json({ error: "Topilmadi" }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    return movementFailure(error)
  }
}
