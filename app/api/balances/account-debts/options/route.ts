import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getAccountDebtOptions } from "@/lib/finance-account-debts"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/balances/account-debts/options → filter options of "Долги по
// счетам" (branches, organizations, zones, client types, agents, deliverers,
// collectors) as the values the /api/balances/account filters match on.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await getAccountDebtOptions())
}
