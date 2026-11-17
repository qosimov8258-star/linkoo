import { NextResponse, type NextRequest } from "next/server"

import { canReadPurchases } from "@/lib/company-money"
import { getCurrentUser } from "@/lib/current-user"
import { listSalesLines } from "@/lib/sales-lines-repo"

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/sales-lines?from&to → the sale and return lines of «Прибыль от агентов» / «Прибыль от товаров»
 * (lib/sales-lines-repo.ts) created or transferred from the warehouse between `from` and `to` (both ISO days, or
 * neither for every line). Every signed-in employee reads the amounts, as /api/order-items; the net cost (and so the
 * profit) only those who may see purchase costs (lib/company-money.ts).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const from = request.nextUrl.searchParams.get("from") ?? ""
  const to = request.nextUrl.searchParams.get("to") ?? ""
  if ((from || to) && !(ISO_DAY.test(from) && ISO_DAY.test(to) && from <= to)) {
    return NextResponse.json({ error: "Неверный период" }, { status: 400 })
  }
  return NextResponse.json(await listSalesLines({ withCost: canReadPurchases(user), window: from ? { from, to } : undefined }))
}
