import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { orderDebtErrorResponse, orderDebtRecalcSchema, recalcOrderDebts } from "@/lib/finance-order-debts"

// POST /api/order-debts/recalc { clientId?, fromDate? } ("Пересчитать" / "Пересчитать с даты")
// → { recalculated, wrongDebtClientCount }.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, orderDebtRecalcSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await recalcOrderDebts(parsed.data, auth.user.displayName))
  } catch (error) {
    return orderDebtErrorResponse(error)
  }
}
