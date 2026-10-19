import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import {
  deleteOrganization,
  getOrganizationDetail,
  organizationErrorResponse,
  organizationInput,
  organizationInputSchema,
  parseOrganizationId,
  updateOrganization,
} from "@/lib/organizations-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Организация не найдена" }

// GET /api/organizations/[id] — demo GET main/division/:id/; ?usage=1 adds where it is used.
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = parseOrganizationId((await params).id)
  const withUsage = new URL(request.url).searchParams.get("usage") === "1"
  const organization = id ? await getOrganizationDetail(id, withUsage) : null
  if (!organization) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(organization)
}

// PUT /api/organizations/[id] {name, limitByDebt} — a rename is carried over to every
// document that stores the organization name (see lib/organizations-repo.ts).
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseOrganizationId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, organizationInputSchema)
  if (parsed.error) return parsed.error

  try {
    const organization = await updateOrganization(id, organizationInput(parsed.data))
    if (!organization) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(organization)
  } catch (error) {
    const response = organizationErrorResponse(error)
    if (response) return response
    throw error
  }
}

// DELETE /api/organizations/[id] — 409 {error, usage} while the organization is referenced.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseOrganizationId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const ok = await deleteOrganization(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const response = organizationErrorResponse(error)
    if (response) return response
    throw error
  }
}
