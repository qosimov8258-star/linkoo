import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { repricingOptions } from "@/lib/repricings-repo"

// GET /api/repricings/options — filter / dialog options: {priceLists, users, products}.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await repricingOptions())
}
