import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getOrderFilterData } from "@/lib/order-filter-data"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/orders/filter-data → {options, facts}: the select lists of the orders filter (Продажи → Заказы) and, per order,
// what its lines and its shop hold (lib/order-filter-data.ts). Read-only.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await getOrderFilterData(user.employeeId))
}
