import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getOrderDebtOptions } from "@/lib/finance-order-debts"

// GET /api/order-debts/options → OrderDebtOptions (values of the filter form).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await getOrderDebtOptions())
}
