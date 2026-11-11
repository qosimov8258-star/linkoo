import { NextResponse } from "next/server"

import { requireCompanyMoneyReader } from "@/lib/company-money"
import { parseCashListQuery } from "@/lib/cash/api"
import { listCashOperations } from "@/lib/cash/list"

// GET /api/cash/unverified?page&pageSize&ordering(&any list filter) → CashListResult of
// unverified, not deleted operations ("Неподтвержденные транзакции").
export async function GET(request: Request) {
  const reader = await requireCompanyMoneyReader()
  if (reader.error) return reader.error
  const parsed = parseCashListQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listCashOperations({ ...parsed.data, unverified: true, withDeleted: false }))
}
