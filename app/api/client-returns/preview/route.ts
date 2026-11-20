import { NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { clientReturnPreviewSchema } from "@/lib/client-returns-api"
import { previewClientReturn } from "@/lib/client-returns-repo"
import { orderErrorResponse } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

// POST /api/client-returns/preview {form of «Добавление возврата» / «Изменение возврата» (+ returnId, kind)} →
// [{productName, unit, orderId, quantity, price, currency, total}]: the step «Подтверждение возврата» of the form's
// «Далее» (Linko's sales/order_return/client_return_preview/). Checked like the save; nothing is written. Errors:
// 400 {error, field, fields?} (Linko's required fields), 403 / 409 as the save.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, clientReturnPreviewSchema)
  if (parsed.error) return parsed.error
  try {
    const { returnId, ...input } = parsed.data
    const lines = await previewClientReturn(input, returnId ?? null, { canChangeCompleted: auth.user.role === "admin" })
    if (!lines) return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
    return NextResponse.json(lines)
  } catch (error) {
    return orderErrorResponse(error)
  }
}
