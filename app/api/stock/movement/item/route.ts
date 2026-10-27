import { NextResponse } from "next/server"

import { movementFailure, movementRequest, stockMovementItem } from "@/lib/stock-movement-report"
import { invalidFieldResponse, NOT_FOUND_MESSAGE } from "@/lib/validation"

// GET /api/stock/movement/item?key=product:12&from&to&warehouse*&branch*&mode&priceList
// → MoveItemDetail: the item's begin / kinds / end per warehouse, the total and
// the period's source documents (newest first, at most 500).
export async function GET(request: Request) {
  const parsed = await movementRequest(request.url)
  if (parsed.error) return parsed.error
  const key = (parsed.params.get("key") ?? "").trim()
  if (!key) return invalidFieldResponse("key", "required")
  try {
    const detail = await stockMovementItem(key, parsed.filters)
    if (!detail) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    return movementFailure(error)
  }
}
