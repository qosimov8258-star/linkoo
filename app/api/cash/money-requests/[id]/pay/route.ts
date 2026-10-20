import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseIdSegment, parseJsonBody } from "@/lib/validation"
import { cashErrorResponse, payMoneyRequestSchema } from "@/lib/cash/api"
import { payMoneyRequest } from "@/lib/cash/money-requests"
import { isDbId } from "@/lib/cash/common"

// POST /api/cash/money-requests/[id]/pay  { cashboxId, date?, amount?, categoryId?, … } → 201 CashWriteResult
// (supplier payment; the request becomes "given").
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = (parseIdSegment((await params).id) ?? 0)
  if (!isDbId(id)) return NextResponse.json({ error: "Запрос не найден" }, { status: 404 })
  const parsed = await parseJsonBody(request, payMoneyRequestSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await payMoneyRequest(id, parsed.data, auth.user.displayName), { status: 201 })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
