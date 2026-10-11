import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getLoyaltyCardDetail, loyaltyDetailQuerySchema, LoyaltyInputError, searchParamsObject } from "@/lib/loyalty-card-repo"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/loyalty-card/[clientId]?page&pageSize — the client's cashback balances and
// movement history (demo GET sales/cash_back/%d/detail).
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = Number((await params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  const query = loyaltyDetailQuerySchema.safeParse(searchParamsObject(new URL(request.url).searchParams))
  if (!query.success) return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: query.error.flatten() }, { status: 400 })
  try {
    return NextResponse.json(await getLoyaltyCardDetail(id, query.data))
  } catch (error) {
    if (error instanceof LoyaltyInputError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
