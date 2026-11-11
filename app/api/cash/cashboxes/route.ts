import { NextResponse } from "next/server"

import { requireCompanyMoneyReader } from "@/lib/company-money"
import { listCashboxesWithBalances } from "@/lib/cash/cashboxes"

// GET /api/cash/cashboxes → CashboxListResult: every cashbox (position order)
// with its all-time ledger balance (left column of "Управления кассой").
export async function GET() {
  const reader = await requireCompanyMoneyReader()
  if (reader.error) return reader.error
  return NextResponse.json(await listCashboxesWithBalances())
}
