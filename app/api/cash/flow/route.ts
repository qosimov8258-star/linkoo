import { NextResponse } from "next/server"

import { getCashFlow } from "@/lib/cash/flow"
import { requireCompanyMoneyReader } from "@/lib/company-money"
import { isIsoDay } from "@/lib/finance/dates"
import { strictId } from "@/lib/strict-number"
import { invalidFieldResponse } from "@/lib/validation"

// GET /api/cash/flow?from&to&cashbox*&branch*&organization* → CashFlowResult ("Движения денежных средств":
// the period's money in / out by article and month, opening and closing balance of the chosen cash desks).
export async function GET(request: Request) {
  const reader = await requireCompanyMoneyReader()
  if (reader.error) return reader.error
  const search = new URL(request.url).searchParams
  const from = search.get("from")?.trim() ?? ""
  const to = search.get("to")?.trim() ?? ""
  if (!isIsoDay(from)) return invalidFieldResponse("from", "YYYY-MM-DD")
  if (!isIsoDay(to)) return invalidFieldResponse("to", "YYYY-MM-DD")
  if (from > to) return invalidFieldResponse("to", "≥ from")
  const texts = (name: string) => search.getAll(name).map((value) => value.trim()).filter(Boolean).slice(0, 200)
  const cashboxIds = texts("cashbox")
    .map((value) => strictId(value))
    .filter((id): id is number => id !== null)
  return NextResponse.json(await getCashFlow({ from, to, cashboxIds, branches: texts("branch"), organizations: texts("organization") }))
}
