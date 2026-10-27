import { NextResponse } from "next/server"

import { cashErrorResponse } from "@/lib/cash/api"
import {
  cashbackRequestCreateSchema,
  cashbackRequestListQuerySchema,
  createCashbackRequest,
  listCashbackRequests,
  searchParamsObject,
} from "@/lib/cashback-withdrawal-requests-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody, zodErrorResponse } from "@/lib/validation"

// GET /api/cashback-withdrawal-requests?search&status&currency&ordering&page&pageSize
// — "Запросы на снятие кэшбэка" (demo GET telegram/cashback_request/).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const query = cashbackRequestListQuerySchema.safeParse(searchParamsObject(new URL(request.url).searchParams))
  if (!query.success) return zodErrorResponse(query.error)
  return NextResponse.json(await listCashbackRequests(query.data))
}

// POST /api/cashback-withdrawal-requests {clientId, amount, currency, comment?, source?} — a new
// pending request. Entry point for the Telegram bot (the demo page itself has no create UI).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, cashbackRequestCreateSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createCashbackRequest(parsed.data, auth.user.displayName || auth.user.username), { status: 201 })
  } catch (error) {
    return cashErrorResponse(error)
  }
}
