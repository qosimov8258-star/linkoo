import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listOrderDebts, parseOrderDebtQuery } from "@/lib/finance-order-debts"

// GET /api/order-debts?toggle=client|order&search&ordering&page&pageSize + filters
// (branch* division* user* deliveryMan* marketTypeParent* zone* status* paymentType marketDebtType
// minPaymentDays paymentDays createdFromDate … acceptedToDate withWrongDebt) → OrderDebtListResult.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseOrderDebtQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listOrderDebts(parsed.data))
}
