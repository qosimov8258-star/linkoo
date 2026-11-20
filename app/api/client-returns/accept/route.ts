import { NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { clientReturnAcceptSchema, stockDateRefusal } from "@/lib/client-returns-api"
import { acceptClientReturns } from "@/lib/client-returns-repo"
import { orderErrorResponse } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

// POST /api/client-returns/accept {ids[], date?} — accepts several pending returns at once (all or nothing); `date`
// (YYYY-MM-DD, not after today) = the day of the acceptance, default now; another day than today needs Linko's
// can_manage_stock_date (stockDateRefusal).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, clientReturnAcceptSchema)
  if (parsed.error) return parsed.error
  const refused = stockDateRefusal(auth.user, parsed.data.date)
  if (refused) return refused
  try {
    return NextResponse.json(await acceptClientReturns(parsed.data.ids, auth.user, parsed.data.date))
  } catch (error) {
    return orderErrorResponse(error)
  }
}
