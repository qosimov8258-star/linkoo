import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDelivererDebtsOptions } from "@/lib/finance-deliverer-debts"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/balances/deliverer-debts/options — "Долги доставщиков" filter
// popup values (branches, organizations, client types), the "Создал" list of
// the correction dialog and whether the user may write corrections.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  return NextResponse.json(await getDelivererDebtsOptions(user))
}
