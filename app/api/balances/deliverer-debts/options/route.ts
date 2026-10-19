import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDelivererDebtsOptions } from "@/lib/finance-deliverer-debts"

// GET /api/balances/deliverer-debts/options — "Долги доставщиков" filter
// popup values (branches, organizations, client types), the "Создал" list of
// the correction dialog and whether the user may write corrections.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  return NextResponse.json(await getDelivererDebtsOptions(user))
}
