import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseIdSegment, parseJsonBody } from "@/lib/validation"
import { detachPayment } from "@/lib/cash/accept"
import { cashErrorResponse, detachSchema } from "@/lib/cash/api"
import { isDbId } from "@/lib/cash/common"

// POST /api/cash/acceptances/[id]/detach  { paymentId } → AcceptanceDetail (payment back to "not accepted").
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = (parseIdSegment((await params).id) ?? 0)
  if (!isDbId(id)) return NextResponse.json({ error: "Операция не найдена" }, { status: 404 })
  const parsed = await parseJsonBody(request, detachSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await detachPayment(id, parsed.data.paymentId, auth.user.displayName))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
