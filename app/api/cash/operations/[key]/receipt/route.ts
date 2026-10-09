import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { cashErrorResponse } from "@/lib/cash/api"
import { getReceipt } from "@/lib/cash/cashboxes"

// GET /api/cash/operations/[key]/receipt → CashReceipt ("Квитанция № …").
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  try {
    return NextResponse.json(await getReceipt((await params).key))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
