import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { getInventoryOptions } from "@/lib/inventory-items-options"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/inventory-items/options → InventoryOptions (filters and dialogs).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await getInventoryOptions())
}
