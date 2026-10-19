import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { listLinkedRepricings } from "@/lib/linked-repricings-repo"
import { repricingConnectedSchema } from "@/lib/repricings-api"
import { createConnectedRepricings, repricingErrorResponse } from "@/lib/repricings-repo"

// GET /api/linked-repricings — journal of the "Переоценку связанных" runs.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await listLinkedRepricings())
}

// POST /api/linked-repricings — same as POST /api/repricings/connected ({priceListId}).
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
