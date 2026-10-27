import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseExpectedPaymentsQuery } from "@/lib/cash/api"
import { listExpectedPayments } from "@/lib/cash/expected-payments"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/cash/expected-payments?search&client*&status*&from&to&all=1&ordering&page&pageSize
// → ExpectedPaymentsResult (orders with an unpaid remainder, one row per order × currency).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseExpectedPaymentsQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listExpectedPayments(parsed.data))
}
