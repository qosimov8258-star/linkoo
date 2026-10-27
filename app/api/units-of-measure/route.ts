import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { unitBodySchema, unitInput } from "@/lib/dictionaries-api"
import { dictionaryListQuery, dictionaryWrite, wantsDictionaryPage } from "@/lib/dictionaries-schema"
import { requireRole } from "@/lib/rbac"
import { createUnitOfMeasure, listUnitTree, listUnitsOfMeasure } from "@/lib/units-of-measure-repo"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"
import { UNIT_ORDERINGS } from "@/components/analytics/units-of-measure-data"

// GET /api/units-of-measure — plain array [{id, name, createdDate, parentId, isWeighted,
// createdAt}] of every unit, id DESC (the pickers). With ?view=tree (or ?paged=1 / ?page /
// ?pageSize) it returns the grid of the page instead (demo main/measurement/hierarchy/):
// {count, results: top-level units with nested children}, filtered by ?search (any level),
// ordered by ?ordering (name | created_date, "-" = descending; default newest first).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const params = new URL(request.url).searchParams
  if (!wantsDictionaryPage(params)) return NextResponse.json(await listUnitsOfMeasure())
  const query = dictionaryListQuery(params, UNIT_ORDERINGS)
  if (query instanceof NextResponse) return query
  return NextResponse.json(await listUnitTree(query))
}

// POST /api/units-of-measure {name, parentId, isWeighted} — demo POST main/measurement/ {name, parent, is_weighted}.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, unitBodySchema)
  if (parsed.error) return parsed.error
  return dictionaryWrite(async () => NextResponse.json(await createUnitOfMeasure(unitInput(parsed.data)), { status: 201 }))
}
