import { NextResponse } from "next/server"

import { createBrand, listBrands, listBrandsPage } from "@/lib/brands-repo"
import { getCurrentUser } from "@/lib/current-user"
import { brandBodySchema, brandInput } from "@/lib/dictionaries-api"
import { dictionaryListQuery, dictionaryWrite, wantsDictionaryPage } from "@/lib/dictionaries-schema"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"
import { BRAND_ORDERINGS } from "@/components/analytics/brands-data"

// GET /api/brands — plain array [{id, name, organization, createdDate, photoUrl, createdAt}]
// of every brand, id DESC (the pickers; photoUrl = GET /api/brands/[id]/image?v=… or null).
// With ?page / ?pageSize (or ?paged=1) it returns the grid of the page instead (demo
// main/brand/): {count, results} filtered by ?search, ordered by ?ordering (id | image |
// name | division | created_date, "-" = descending; default name).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const params = new URL(request.url).searchParams
  if (!wantsDictionaryPage(params)) return NextResponse.json(await listBrands())
  const query = dictionaryListQuery(params, BRAND_ORDERINGS)
  if (query instanceof NextResponse) return query
  return NextResponse.json(await listBrandsPage(query))
}

// POST /api/brands {name, organization, image} — demo POST main/brand/ {name, division, image}.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, brandBodySchema)
  if (parsed.error) return parsed.error
  return dictionaryWrite(async () => NextResponse.json(await createBrand(brandInput(parsed.data)), { status: 201 }))
}
