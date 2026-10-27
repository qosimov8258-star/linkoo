import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody, INVALID_DATA_MESSAGE } from "@/lib/validation"
import { variantSchema } from "@/lib/finance-store-reconciliation"
import {
  createReconciliationRequest,
  FinanceInputError,
  listReconciliationMessages,
  messageCreateSchema,
} from "@/lib/finance-store-reconciliation-writes"

// GET  /api/store-reconciliation/messages?variant&key&page&pageSize (or ?clientId) —
//      the client's / account's reconciliation requests (demo market/market/messages
//      {market} / {client}).
// POST /api/store-reconciliation/messages {variant?, key | clientId, debtDate?, mode?} —
//      "Отправить сверку" (demo telegram/message {send_balance, market | client}).
//      No Telegram bot is connected: the request is recorded with status "not_send".
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const params = new URL(request.url).searchParams
  const variant = variantSchema.safeParse(params.get("variant") || "client")
  const key = (params.get("key") || params.get("clientId") || "").trim()
  if (!variant.success || !key || key.length > 200) return NextResponse.json({ error: INVALID_DATA_MESSAGE }, { status: 400 })
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1))
  const pageSize = Math.max(1, Math.floor(Number(params.get("pageSize")) || 25))
  return NextResponse.json(await listReconciliationMessages(variant.data, key, page, pageSize))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, messageCreateSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createReconciliationRequest(parsed.data, auth.user.displayName), { status: 201 })
  } catch (error) {
    if (error instanceof FinanceInputError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
