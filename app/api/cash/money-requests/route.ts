import { NextResponse } from "next/server"

import { requireSupplierMoneyReader } from "@/lib/company-money"
import { parseMoneyRequestsQuery } from "@/lib/cash/api"
import { listMoneyRequests } from "@/lib/cash/money-requests"

// GET /api/cash/money-requests?status=pending|approved|given|cancelled&search&supplier*&ordering&page&pageSize
// → { count, page, pageSize, rows: MoneyRequest[] } (with supplier balances in the request currency).
export async function GET(request: Request) {
  const reader = await requireSupplierMoneyReader()
  if (reader.error) return reader.error
  const parsed = parseMoneyRequestsQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listMoneyRequests(parsed.data))
}
