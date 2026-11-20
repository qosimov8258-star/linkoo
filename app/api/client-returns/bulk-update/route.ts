import { NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { bulkUpdateClientReturns, bulkUpdatePeople, clientReturnBulkUpdateSchema } from "@/lib/client-returns-bulk"
import { orderErrorResponse } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

// GET /api/client-returns/bulk-update → {agents, deliverers}: the dialog's lists, [{id, name}] in id order.
export async function GET() {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  return NextResponse.json(await bulkUpdatePeople())
}

// POST /api/client-returns/bulk-update {ids[], agent?, deliverer?} — «Изменить выбранные возвраты»: the responsible
// agent and / or the delivery man of the chosen returns (an empty field changes nothing) → {updated}.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, clientReturnBulkUpdateSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await bulkUpdateClientReturns(parsed.data, auth.user))
  } catch (error) {
    return orderErrorResponse(error)
  }
}
