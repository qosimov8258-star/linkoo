import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getClientBalanceOptions } from "@/lib/finance-client-balance"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/balances/client-balance/options — values of the "Баланс клиентов"
// filter popup (branches, organizations, zones, client types, agents,
// delivery people, collectors).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  return NextResponse.json(await getClientBalanceOptions())
}
