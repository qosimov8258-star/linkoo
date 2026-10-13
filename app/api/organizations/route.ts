import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import {
  createOrganization,
  listOrganizations,
  listOrganizationsPage,
  organizationErrorResponse,
  organizationInput,
  organizationInputSchema,
  organizationListQuerySchema,
  searchParamsObject,
  wantsPagedList,
} from "@/lib/organizations-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// GET /api/organizations — plain array [{id, name, limitByDebt}] for the organization
// selects of the other pages (optional ?search=). With ?page / ?pageSize (or ?paged=1)
// it returns the grid of the "Организация" page instead: {count, results} filtered by
// ?search and ordered by ?ordering (default name) — demo GET main/division/.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const params = new URL(request.url).searchParams
  const query = organizationListQuerySchema.safeParse(searchParamsObject(params))
  if (!query.success) return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: query.error.flatten() }, { status: 400 })
  if (wantsPagedList(params)) return NextResponse.json(await listOrganizationsPage(query.data))
  return NextResponse.json(await listOrganizations(query.data.search ?? ""))
}

// POST /api/organizations {name, limitByDebt} — demo POST /main/division/ {name, use_limit_for_debt}.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, organizationInputSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createOrganization(organizationInput(parsed.data)), { status: 201 })
  } catch (error) {
    const response = organizationErrorResponse(error)
    if (response) return response
    throw error
  }
}
