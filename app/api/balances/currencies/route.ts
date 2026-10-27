import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/balances/currencies → { base, currencies: FinanceCurrency[] } with
// canonical codes (SUM/USD/EUR…) and demo labels (Euro), base first.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const context = await loadCurrencyContext(getDb())
  return NextResponse.json({ base: context.base, currencies: context.currencies })
}
