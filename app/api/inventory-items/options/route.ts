import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getInventoryOptions } from "@/lib/inventory-items-options"

// GET /api/inventory-items/options → InventoryOptions (filters and dialogs).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await getInventoryOptions())
}
