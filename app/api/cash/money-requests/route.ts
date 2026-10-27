import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseMoneyRequestsQuery } from "@/lib/cash/api"
import { listMoneyRequests } from "@/lib/cash/money-requests"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/cash/money-requests?status=pending|approved|given|cancelled&search&supplier*&ordering&page&pageSize
// → { count, page, pageSize, rows: MoneyRequest[] } (with supplier balances in the request currency).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseMoneyRequestsQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listMoneyRequests(parsed.data))
}
