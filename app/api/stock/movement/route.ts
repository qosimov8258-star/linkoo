import { NextResponse } from "next/server"

import { movementFailure, movementRequest, parsePaging, stockMovementList } from "@/lib/stock-movement-report"

// GET /api/stock/movement?from&to&warehouse*&branch*&organization*&type*&subcategory*&brand*
//   &search&groupBy=product|brand|type|stock|branch&mode=quantity|cost|price&priceList
//   &transaction=exist|not_exist&balance=exist|not_exist&ordering=[-]name|[-]<field>[.value]&page&pageSize (0 = all)
// → MoveListResult ("Остаток на определенную дату", demo api/v2/stats/stock/products).
export async function GET(request: Request) {
  const parsed = await movementRequest(request.url)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await stockMovementList(parsed.filters, parsePaging(parsed.params)))
  } catch (error) {
    return movementFailure(error)
  }
}
