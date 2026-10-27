import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseIdSegment, parseJsonBody } from "@/lib/validation"
import { cashErrorResponse, payOrderSchema } from "@/lib/cash/api"
import { payOrder } from "@/lib/cash/expected-payments"
import { isDbId } from "@/lib/cash/common"

// POST /api/cash/orders/[id]/pay  PayOrderInput → 201 CashWriteResult (customer payment op 3 with order_id).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = (parseIdSegment((await params).id) ?? 0)
  if (!isDbId(id)) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
  const parsed = await parseJsonBody(request, payOrderSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await payOrder(id, parsed.data, auth.user.displayName), { status: 201 })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
