import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { productTypeBodySchema, productTypeInput } from "@/lib/dictionaries-api"
import { dictionaryListQuery, dictionaryWrite, wantsDictionaryPage } from "@/lib/dictionaries-schema"
import { createProductType, listProductTypeTree, listProductTypes } from "@/lib/product-types-repo"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"
import { PRODUCT_TYPE_ORDERINGS, PRODUCT_TYPE_PAGE_SIZE } from "@/components/analytics/product-types-data"

// GET /api/product-types — plain array [{id, name, organization, parentId, showInBot,
// createdDate, position, imageUrl, createdAt}] of every type, id DESC (the pickers).
// With ?view=tree (or ?paged=1 / ?page / ?pageSize) it returns the grid of the page instead
// (demo main/product_type/as_menu/): {count, results: top-level types with nested
// children}, filtered by ?search (any level), ordered by ?ordering (name | division |
// created_date, "-" = descending; default Порядок, name) and paged over the top level.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const params = new URL(request.url).searchParams
  if (!wantsDictionaryPage(params)) return NextResponse.json(await listProductTypes())
  const query = dictionaryListQuery(params, PRODUCT_TYPE_ORDERINGS, PRODUCT_TYPE_PAGE_SIZE)
  if (query instanceof NextResponse) return query
  return NextResponse.json(await listProductTypeTree(query))
}

// POST /api/product-types {name, organization, parentId, showInBot, position, image} —
// demo POST main/product_type/ {name, division, parent, show_in_market, order, image}.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, productTypeBodySchema)
  if (parsed.error) return parsed.error
  return dictionaryWrite(async () => NextResponse.json(await createProductType(productTypeInput(parsed.data)), { status: 201 }))
}
