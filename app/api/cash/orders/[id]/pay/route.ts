import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { cashErrorResponse, payOrderSchema } from "@/lib/cash/api"
import { payOrder } from "@/lib/cash/expected-payments"

// POST /api/cash/orders/[id]/pay  PayOrderInput → 201 CashWriteResult (customer payment op 3 with order_id).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  const parsed = await parseJsonBody(request, payOrderSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await payOrder(id, parsed.data, auth.user.displayName), { status: 201 })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
