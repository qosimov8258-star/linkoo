import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseInventoryQuery } from "@/lib/inventory-items-api"
import { listInventoryChecks } from "@/lib/inventory-items-repo"

// GET /api/inventory-items/checks?… — "История проверки" (demo main/gear_check).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseInventoryQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listInventoryChecks(parsed.data))
}
