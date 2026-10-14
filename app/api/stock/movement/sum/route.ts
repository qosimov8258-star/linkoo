import { NextResponse } from "next/server"

import { movementFailure, movementRequest, stockMovementSum } from "@/lib/stock-movement-report"

// GET /api/stock/movement/sum?<the list filters> → MoveSumResult: the 9 cards
// (demo api/v2/stats/stock/sum): begin, end and every kind over the filtered rows.
export async function GET(request: Request) {
  const parsed = await movementRequest(request.url)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await stockMovementSum(parsed.filters))
  } catch (error) {
    return movementFailure(error)
  }
}
