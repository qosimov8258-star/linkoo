import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { withDbErrors } from "@/lib/db-errors"
import { checkOrderTimeRestriction } from "@/lib/order-time-restrictions-repo"
import { parseOrderTimeAction } from "@/lib/order-time-restrictions-schema"
import { INVALID_DATA_MESSAGE, invalidFieldResponse, notSignedInResponse } from "@/lib/validation"

// GET /api/order-time-restrictions/check?action=create|edit → for the signed-in account:
// {action, allowed, restricted, status, fromTime, toTime, serverTime, reason}
// What the agent app asks before it lets the agent create or edit an order (the order APIs
// enforce the same rule themselves). `reason` is a Russian i18n key when not allowed;
// serverTime is the Asia/Tashkent clock ("HH:MM:SS") the answer used.
export const GET = withDbErrors(async (request: NextRequest) => {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const action = parseOrderTimeAction(request.nextUrl.searchParams.get("action"))
  if (!action) return invalidFieldResponse("action", "create | edit", INVALID_DATA_MESSAGE)
  return NextResponse.json(await checkOrderTimeRestriction(action, user), { headers: { "Cache-Control": "no-store" } })
})
