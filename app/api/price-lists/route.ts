import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { parsePriceListQuery, priceListBodySchema, toPriceListInput } from "@/lib/price-lists-api"
import { createPriceList, listPriceLists, listPriceListsPage, priceListErrorResponse } from "@/lib/price-lists-repo"

// GET /api/price-lists — plain array of price lists for the pickers of the other pages
// ({id, name, currency, createdDate, linkedList, calcMethod, …}): ACTIVE lists only, by position
// (?active=all | false opts in to the others).
// With ?paged=1 / ?page / ?pageSize it returns the grid of the "Прайс-листы" page instead:
// {count, results} with ?search, ?ordering, ?active (default all) — demo GET sales/price_list/.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const { paged, active } = parsePriceListQuery(request.url)
  if (paged) return NextResponse.json(await listPriceListsPage(paged))
  return NextResponse.json(await listPriceLists({ active }))
}

// POST /api/price-lists — demo POST sales/price_list/ (body: lib/price-lists-api.ts).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, priceListBodySchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await createPriceList(toPriceListInput(parsed.data)), { status: 201 })
  } catch (error) {
    const response = priceListErrorResponse(error)
    if (response) return response
    throw error
  }
}
