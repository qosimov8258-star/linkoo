import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"
import { parseRepricingListQuery, repricingCreateSchema, toRepricingInput } from "@/lib/repricings-api"
import { createRepricing, listRepricings, listRepricingsPage, repricingErrorResponse } from "@/lib/repricings-repo"

// GET /api/repricings — plain array of repricings (newest first). With ?paged=1 / ?page / ?pageSize:
// {count, results} filtered by ?priceList (ids), ?user, ?status (finished | canceled), ?product
// ("product:12"), ?search, ordered by ?ordering — demo GET main/reprice/.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const query = parseRepricingListQuery(request.url)
  return NextResponse.json(query ? await listRepricingsPage(query) : await listRepricings())
}

// POST /api/repricings — demo POST main/reprice/: {priceListId, currency, comment?, products:
// [{kind, id, price}], connected?} → a finished repricing whose prices are applied to the items
// (+ the linked price lists when `connected`). 201 {repricing, linked, skipped}.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, repricingCreateSchema)
  if (parsed.error) return parsed.error
  const input = toRepricingInput(parsed.data)
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 })
  try {
    return NextResponse.json(await createRepricing(input, auth.user.displayName), { status: 201 })
  } catch (error) {
    const response = repricingErrorResponse(error)
    if (response) return response
    throw error
  }
}
