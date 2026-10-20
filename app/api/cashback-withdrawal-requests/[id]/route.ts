import { NextResponse } from "next/server"

import { cashErrorResponse } from "@/lib/cash/api"
import { cashbackRequestDecisionSchema, decideCashbackRequest, getCashbackRequestDetail } from "@/lib/cashback-withdrawal-requests-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

/** Canonical digits only ("0x10" / "1e1" never resolve to another request). */
function requestId(value: string): number | null {
  return parseIdSegment(value)
}

// GET /api/cashback-withdrawal-requests/[id] — the request + the client's cashback balance in its
// currency and the cashboxes of that currency (demo GET telegram/cashback_request/%d/).
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = requestId((await params).id)
  if (!id) return NextResponse.json({ error: "Запрос не найден" }, { status: 404 })
  try {
    return NextResponse.json(await getCashbackRequestDetail(id))
  } catch (error) {
    return cashErrorResponse(error)
  }
}

// PUT /api/cashback-withdrawal-requests/[id] {status: "confirmed", cashboxId} | {status: "rejected"}
// (demo PUT {cashbox, status}). Confirming pays the cashback out of the cashbox (cash op 22).
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = requestId((await params).id)
  if (!id) return NextResponse.json({ error: "Запрос не найден" }, { status: 404 })
  const parsed = await parseJsonBody(request, cashbackRequestDecisionSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await decideCashbackRequest(id, parsed.data, auth.user.displayName || auth.user.username))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
