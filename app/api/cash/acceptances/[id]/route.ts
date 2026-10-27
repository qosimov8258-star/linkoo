import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { getAcceptance, updateAcceptance } from "@/lib/cash/accept"
import { cashErrorResponse, updateAcceptanceSchema } from "@/lib/cash/api"
import { isDbId } from "@/lib/cash/common"

type Params = { params: Promise<{ id: string }> }

function parseId(value: string): number | null {
  const id = parseIdSegment(value) ?? 0
  return isDbId(id) ? id : null
}

// GET /api/cash/acceptances/[id] → AcceptanceDetail (type-8 info: header + payments).
// PUT /api/cash/acceptances/[id]  { payments?, branch?, organization?, cashboxId?, deliveryManId?, date?, comment? } → AcceptanceDetail.
export async function GET(_request: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseId((await params).id)
  const detail = id ? await getAcceptance(id) : null
  if (!detail) return NextResponse.json({ error: "Операция не найдена" }, { status: 404 })
  return NextResponse.json(detail)
}

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseId((await params).id)
  if (!id) return NextResponse.json({ error: "Операция не найдена" }, { status: 404 })
  const parsed = await parseJsonBody(request, updateAcceptanceSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await updateAcceptance(id, parsed.data, auth.user.displayName))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
