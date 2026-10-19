import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import {
  createLoyaltyCardTransaction,
  listLoyaltyCards,
  LoyaltyInputError,
  loyaltyListQuerySchema,
  loyaltyTransactionSchema,
  searchParamsObject,
} from "@/lib/loyalty-card-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// GET /api/loyalty-card?search&clientType&ordering&page&pageSize — every client's
// cashback balance per currency (demo GET sales/cash_back/).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const query = loyaltyListQuerySchema.safeParse(searchParamsObject(new URL(request.url).searchParams))
  if (!query.success) return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: query.error.flatten() }, { status: 400 })
  return NextResponse.json(await listLoyaltyCards(query.data))
}

// POST /api/loyalty-card {clientId, kind: "add" | "expense", amount, currency, comment} —
// "Добавить" / "Списать" (demo POST sales/cash_back/custom_price/).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, loyaltyTransactionSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createLoyaltyCardTransaction(parsed.data, auth.user.displayName || auth.user.username), { status: 201 })
  } catch (error) {
    if (error instanceof LoyaltyInputError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
