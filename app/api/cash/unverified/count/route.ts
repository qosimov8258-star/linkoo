import { NextResponse } from "next/server"

import { requireCompanyMoneyReader } from "@/lib/company-money"
import { countUnverifiedOperations } from "@/lib/cash/list"

// GET /api/cash/unverified/count → { count } (clock badge, polled every 5 s).
export async function GET() {
  const reader = await requireCompanyMoneyReader()
  if (reader.error) return reader.error
  return NextResponse.json({ count: await countUnverifiedOperations() })
}
