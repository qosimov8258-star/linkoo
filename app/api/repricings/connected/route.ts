import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { repricingConnectedSchema } from "@/lib/repricings-api"
import { createConnectedRepricings, repricingErrorResponse } from "@/lib/repricings-repo"

// POST /api/repricings/connected — demo POST main/reprice/connected/ {price_list} ("Переоценку
// связанных"): {priceListId} → repricings of the lists linked to it (calc method of each list, from
// the current prices); 201 {repricing: null, linked, skipped}.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, repricingConnectedSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await createConnectedRepricings(parsed.data.priceListId, auth.user.displayName), { status: 201 })
  } catch (error) {
    const response = repricingErrorResponse(error)
    if (response) return response
    throw error
  }
}
