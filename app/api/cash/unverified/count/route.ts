import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { countUnverifiedOperations } from "@/lib/cash/list"

// GET /api/cash/unverified/count → { count } (clock badge, polled every 5 s).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json({ count: await countUnverifiedOperations() })
}
