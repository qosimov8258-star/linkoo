import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getStoreReconciliationList, parseStoreReconciliationQuery } from "@/lib/finance-store-reconciliation"

// GET /api/store-reconciliation — "Сверка магазина через бот" (variant=client,
// default; demo sales/market_balance) / "Сверка счетов" (variant=account; demo
// sales/client_balances) + …/total + stats/client/balances in one response:
// rows of one page, per-currency cash / bank / total of all filtered rows and
// the loaners / borrowers summary. Params: see parseStoreReconciliationQuery.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const parsed = parseStoreReconciliationQuery(request.url)
  if (parsed.error) return parsed.error

  return NextResponse.json(await getStoreReconciliationList(parsed.data))
}
