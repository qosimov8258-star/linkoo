import { NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { clientReturnAcceptSchema } from "@/lib/client-returns-api"
import { acceptClientReturns } from "@/lib/client-returns-repo"
import { orderErrorResponse } from "@/lib/orders-api"
import { requireRole } from "@/lib/rbac"

// POST /api/client-returns/accept {ids[]} — accepts several pending returns at once (all or nothing).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, clientReturnAcceptSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await acceptClientReturns(parsed.data.ids, auth.user))
  } catch (error) {
    return orderErrorResponse(error)
  }
}
