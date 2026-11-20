import { NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { clientReturnAcceptOneSchema, stockDateRefusal } from "@/lib/client-returns-api"
import { acceptClientReturns } from "@/lib/client-returns-repo"
import { orderErrorResponse, routeId } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

// POST /api/client-returns/[id]/accept {date?} — "Принять на склад": stock comes in, the client is credited. `date`
// (YYYY-MM-DD, not after today; Linko's «Дата» of the confirmation) is the day of the acceptance, default now; another
// day than today needs Linko's can_manage_stock_date (stockDateRefusal). No body is the same as {}.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = routeId((await params).id)
  if (!id) return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
  let date: string | undefined
  if (request.body && request.headers.get("content-length") !== "0") {
    const parsed = await parseBody(request, clientReturnAcceptOneSchema)
    if (parsed.error) return parsed.error
    date = parsed.data.date
  }
  const refused = stockDateRefusal(auth.user, date)
  if (refused) return refused
  try {
    const [row] = await acceptClientReturns([id], auth.user, date)
    return NextResponse.json(row)
  } catch (error) {
    return orderErrorResponse(error)
  }
}
