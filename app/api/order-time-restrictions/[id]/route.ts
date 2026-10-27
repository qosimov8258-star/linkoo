import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { withDbErrors } from "@/lib/db-errors"
import { orderTimeRestrictionErrorResponse } from "@/lib/order-time-restrictions-guard"
import { getOrderTimeRestriction, updateOrderTimeRestriction } from "@/lib/order-time-restrictions-repo"
import { MSG_RESTRICTION_NOT_FOUND } from "@/lib/order-time-restrictions-rules"
import { orderTimeRestrictionUpdateSchema } from "@/lib/order-time-restrictions-schema"
import { requirePermission } from "@/lib/rbac"
import { invalidIdResponse, notSignedInResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/order-time-restrictions/[id] → one system restriction (404 for any other id).
export const GET = withDbErrors(async (_request: Request, { params }: RouteParams) => {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const item = await getOrderTimeRestriction(id)
  if (!item) return NextResponse.json({ error: MSG_RESTRICTION_NOT_FOUND }, { status: 404 })
  return NextResponse.json(item)
})

// PUT /api/order-time-restrictions/[id] {status: 1..4, fromTime, toTime ("HH:MM", for 3 / 4),
// isAll: boolean, employeeIds?: number[]} → the saved restriction. Needs settings.manage
// (an agent must not lift the restriction that applies to them).
export const PUT = withDbErrors(async (request: Request, { params }: RouteParams) => {
  const auth = await requirePermission("settings.manage")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, orderTimeRestrictionUpdateSchema)
  if (parsed.error) return parsed.error

  try {
    const item = await updateOrderTimeRestriction(id, parsed.data)
    if (!item) return NextResponse.json({ error: MSG_RESTRICTION_NOT_FOUND }, { status: 404 })
    return NextResponse.json(item)
  } catch (error) {
    return orderTimeRestrictionErrorResponse(error)
  }
})
