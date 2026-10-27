import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseInventoryQuery } from "@/lib/inventory-items-api"
import { getInventoryTotals } from "@/lib/inventory-items-repo"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/inventory-items/totals?<list filters> → { reviewed, notReviewed, total } (demo total_reviews).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseInventoryQuery(request.url)
  if (parsed.error) return parsed.error
  return NextResponse.json(await getInventoryTotals(parsed.data))
}
