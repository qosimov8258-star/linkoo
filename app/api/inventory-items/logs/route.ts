import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseInventoryQuery } from "@/lib/inventory-items-api"
import { listInventoryLogs } from "@/lib/inventory-items-repo"

// GET /api/inventory-items/logs?… — "История движений" (demo main/gear_log).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseInventoryQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await listInventoryLogs(parsed.data))
}
