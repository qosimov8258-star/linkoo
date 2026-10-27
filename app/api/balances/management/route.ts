import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseManagementQuery } from "@/lib/finance/api"
import { getManagementBalance } from "@/lib/finance/management"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/balances/management?from&to[&organization…][&branch…] → ManagementBalanceResult
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const parsed = parseManagementQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await getManagementBalance(parsed.data))
}
