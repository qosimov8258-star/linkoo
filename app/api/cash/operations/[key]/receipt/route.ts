import { NextResponse } from "next/server"

import { requireCompanyMoneyReader } from "@/lib/company-money"
import { cashErrorResponse } from "@/lib/cash/api"
import { getReceipt } from "@/lib/cash/cashboxes"

// GET /api/cash/operations/[key]/receipt → CashReceipt ("Квитанция № …").
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const reader = await requireCompanyMoneyReader()
  if (reader.error) return reader.error
  try {
    return NextResponse.json(await getReceipt((await params).key))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
