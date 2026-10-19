import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"

// GET /api/balances/currencies → { base, currencies: FinanceCurrency[] } with
// canonical codes (SUM/USD/EUR…) and demo labels (Euro), base first.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const context = await loadCurrencyContext(getDb())
  return NextResponse.json({ base: context.base, currencies: context.currencies })
}
