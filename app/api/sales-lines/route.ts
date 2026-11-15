import { NextResponse } from "next/server"

import { canReadPurchases } from "@/lib/company-money"
import { getCurrentUser } from "@/lib/current-user"
import { listSalesLines } from "@/lib/sales-lines-repo"

/**
 * GET /api/sales-lines → the sale and return lines of «Прибыль от агентов» / «Прибыль от товаров»
 * (lib/sales-lines-repo.ts). Every signed-in employee reads the amounts, as /api/order-items; the net cost
 * (and so the profit) only those who may see purchase costs (lib/company-money.ts).
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listSalesLines({ withCost: canReadPurchases(user) }))
}
