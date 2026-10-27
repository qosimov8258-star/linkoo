import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getLoyaltyCardDetail, loyaltyDetailQuerySchema, LoyaltyInputError, searchParamsObject } from "@/lib/loyalty-card-repo"
import { isDbId } from "@/lib/cash/common"
import { notSignedInResponse, parseIdSegment, zodErrorResponse } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/loyalty-card/[clientId]?page&pageSize — the client's cashback balances and
// movement history (demo GET sales/cash_back/%d/detail).
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = (parseIdSegment((await params).id) ?? 0)
  if (!isDbId(id)) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  const query = loyaltyDetailQuerySchema.safeParse(searchParamsObject(new URL(request.url).searchParams))
  if (!query.success) return zodErrorResponse(query.error)
  try {
    return NextResponse.json(await getLoyaltyCardDetail(id, query.data))
  } catch (error) {
    if (error instanceof LoyaltyInputError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
