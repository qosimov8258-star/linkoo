import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseRepricingId } from "@/lib/repricings-api"
import { cancelRepricing, getRepricing, repricingErrorResponse } from "@/lib/repricings-repo"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Переоценка не найдена" }

// GET /api/repricings/[id] — demo GET main/reprice/:id/: the document with its lines and the ids of
// the linked repricings it created (`children`).
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = parseRepricingId((await params).id)
  const repricing = id ? await getRepricing(id) : null
  if (!repricing) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(repricing)
}

// DELETE /api/repricings/[id] — demo DELETE main/reprice/:id/: cancels the repricing ("отменен") and
// restores the previous prices. 409 {error, conflicts: [ids]} when a later finished repricing of the
// same price list touched one of its items.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRepricingId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const repricing = await cancelRepricing(id, auth.user.displayName)
    if (!repricing) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(repricing)
  } catch (error) {
    const response = repricingErrorResponse(error)
    if (response) return response
    throw error
  }
}
