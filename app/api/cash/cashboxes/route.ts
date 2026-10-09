import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listCashboxesWithBalances } from "@/lib/cash/cashboxes"

// GET /api/cash/cashboxes → CashboxListResult: every cashbox (position order)
// with its all-time ledger balance (left column of "Управления кассой").
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await listCashboxesWithBalances())
}
