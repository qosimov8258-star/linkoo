import { NextResponse } from "next/server"

import { withDbErrors } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { deleteUserNotification, markUserNotificationViewed } from "@/lib/user-notifications-repo"
import { invalidIdResponse, NOT_FOUND_MESSAGE, parseIdSegment } from "@/lib/validation"

// One notification of the signed-in user (self-service, see ../route.ts).
// PATCH  → marks it viewed → {ok}
// DELETE → removes it → {ok}
// An id that is not a positive int4 answers 400; another user's notification answers 404,
// exactly like a missing one, so ids of other users cannot be probed.

type RouteParams = { params: Promise<{ id: string }> }

export const PATCH = withDbErrors(async (_request: Request, { params }: RouteParams) => {
  const check = await requireRole("viewer")
  if ("error" in check) return check.error
  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  if (!(await markUserNotificationViewed(check.user.id, id))) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 })
  return NextResponse.json({ ok: true })
})

export const DELETE = withDbErrors(async (_request: Request, { params }: RouteParams) => {
  const check = await requireRole("viewer")
  if ("error" in check) return check.error
  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  if (!(await deleteUserNotification(check.user.id, id))) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 })
  return NextResponse.json({ ok: true })
})
