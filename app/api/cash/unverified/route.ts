import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseCashListQuery } from "@/lib/cash/api"
import { listCashOperations } from "@/lib/cash/list"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/cash/unverified?page&pageSize&ordering(&any list filter) → CashListResult of
// unverified, not deleted operations ("Неподтвержденные транзакции").
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseCashListQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listCashOperations({ ...parsed.data, unverified: true, withDeleted: false }))
}
