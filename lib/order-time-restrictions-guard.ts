import "server-only"

import { NextResponse } from "next/server"

import { dbErrorResponse } from "@/lib/db-errors"
import { checkOrderTimeRestriction, OrderTimeRestrictionError, type OrderTimeActor } from "@/lib/order-time-restrictions-repo"
import { MSG_EMPLOYEE_NOT_FOUND, type OrderTimeAction } from "@/lib/order-time-restrictions-rules"

/** JSON answer of an error thrown by the restrictions repo: its own status and Russian key,
 * a busy database as 503 / 409, an employee deleted meanwhile (foreign key) as 400.
 * Anything else is rethrown. */
export function orderTimeRestrictionErrorResponse(error: unknown): NextResponse {
  if (error instanceof OrderTimeRestrictionError) {
    return NextResponse.json({ error: error.message, ...error.details }, { status: error.status })
  }
  if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23503") {
    return NextResponse.json({ error: MSG_EMPLOYEE_NOT_FOUND, field: "employeeIds" }, { status: 400 })
  }
  const busy = dbErrorResponse(error)
  if (busy) return busy
  throw error
}

// Enforcement of Ограничение времени in the order APIs. Call it at the top of an order
// write route, right after requireRole and BEFORE any transaction:
//   const blocked = await orderTimeRestrictionResponse("create", auth.user)
//   if (blocked) return blocked
// "create": POST /api/orders. "edit": every change of an existing order (PATCH
// /api/orders/[id], its lines under /api/orders/[id]/items/**).

/** Code of the refusal body, so a client can tell it from a missing permission. */
export const ORDER_TIME_RESTRICTED_CODE = "orderTimeRestricted"

/** 409 {error, code: "orderTimeRestricted", action, status, fromTime, toTime, serverTime} when
 * the signed-in account may not do `action` now; null when it may. 409, not 403: the pages
 * answer a 403 with "Недостаточно прав", which would hide the time window from the user.
 * A busy database answers 503 / 409 (never a 500). */
export async function orderTimeRestrictionResponse(action: OrderTimeAction, user: OrderTimeActor): Promise<NextResponse | null> {
  let check: Awaited<ReturnType<typeof checkOrderTimeRestriction>>
  try {
    check = await checkOrderTimeRestriction(action, user)
  } catch (error) {
    return orderTimeRestrictionErrorResponse(error)
  }
  if (check.allowed) return null
  return NextResponse.json(
    {
      error: check.reason,
      code: ORDER_TIME_RESTRICTED_CODE,
      action: check.action,
      status: check.status,
      fromTime: check.fromTime,
      toTime: check.toTime,
      serverTime: check.serverTime,
    },
    { status: 409 },
  )
}
