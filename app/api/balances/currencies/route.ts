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
  // `currencies`: the ones the app works in (only the app currency when one is chosen in Настройки → Валюта
  // приложения); `all`: every currency of Валюты with its rate, for documents stored in another one.
  return NextResponse.json({ base: context.base, currencies: context.currencies, all: context.all })
}
