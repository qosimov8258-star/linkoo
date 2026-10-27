import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listAgentPayments } from "@/lib/cash/accept"
import { parseAcceptPaymentsQuery } from "@/lib/cash/api"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/cash/accept-cash/payments?agent&currency&organization&branch&agentCashbox&from&to&page&pageSize
// → { count, page, pageSize, rows: AgentPayment[], total, currency } (expanded group of "Принять наличные").
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseAcceptPaymentsQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listAgentPayments(parsed.data))
}
