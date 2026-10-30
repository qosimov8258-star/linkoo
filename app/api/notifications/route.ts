import { NextResponse } from "next/server"

import { withDbErrors } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { listUserNotifications, markAllUserNotificationsViewed, MAX_NOTIFICATIONS_PAGE_SIZE } from "@/lib/user-notifications-repo"
import { INVALID_DATA_MESSAGE, invalidFieldResponse, parseIdSegment } from "@/lib/validation"

// The signed-in user's own notifications (self-service: lib/capabilities-catalog.ts
// SELF_SERVICE_PREFIXES). Every query is scoped to the caller; nobody sees or changes
// another user's rows, administrators included.
//
// GET   /api/notifications?page=1&pageSize=15[&beforeId=123]
//       → {count, unviewed, page, pageSize, results: UserNotification[]} (newest first;
//       beforeId: the next rows after the last one shown, unaffected by deletions)
// PATCH /api/notifications → marks all of the caller's notifications viewed → {ok, changed}

const DEFAULT_PAGE_SIZE = 15
const MAX_PAGE = 1_000_000

/** An optional positive integer query parameter: absent / "" → fallback, else digits only. */
function intParam(params: URLSearchParams, name: string, fallback: number, max: number): number | null {
  const text = params.get(name)
  if (text === null || text === "") return fallback
  if (!/^\d{1,10}$/.test(text)) return null
  const value = Number(text)
  return value >= 1 && value <= max ? value : null
}

export const GET = withDbErrors(async (request: Request) => {
  const check = await requireRole("viewer")
  if ("error" in check) return check.error
  const params = new URL(request.url).searchParams
  const page = intParam(params, "page", 1, MAX_PAGE)
  if (page === null) return invalidFieldResponse("page", "page", INVALID_DATA_MESSAGE)
  const pageSize = intParam(params, "pageSize", DEFAULT_PAGE_SIZE, MAX_NOTIFICATIONS_PAGE_SIZE)
  if (pageSize === null) return invalidFieldResponse("pageSize", "pageSize", INVALID_DATA_MESSAGE)
  const beforeText = params.get("beforeId")
  const beforeId = beforeText === null || beforeText === "" ? null : parseIdSegment(beforeText)
  if (beforeText !== null && beforeText !== "" && beforeId === null) return invalidFieldResponse("beforeId", "beforeId", INVALID_DATA_MESSAGE)
  const list = await listUserNotifications(check.user.id, { page, pageSize, beforeId })
  return NextResponse.json({ ...list, page, pageSize })
})

export const PATCH = withDbErrors(async () => {
  const check = await requireRole("viewer")
  if ("error" in check) return check.error
  const changed = await markAllUserNotificationsViewed(check.user.id)
  return NextResponse.json({ ok: true, changed })
})
