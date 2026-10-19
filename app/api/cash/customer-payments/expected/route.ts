import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listExpectedOrders, parseExpectedOrdersQuery } from "@/lib/cash/customer-payments"

// GET /api/cash/customer-payments/expected?search&branch*&client*&agent*&paymentType&deliveryMan*&organization*&status*
//   &from&to&deliveryFrom&deliveryTo&dueFrom&dueTo&ordering&page&pageSize → ExpectedOrdersResult ("Ожидаемые оплаты").
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseExpectedOrdersQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listExpectedOrders(parsed.data))
}
