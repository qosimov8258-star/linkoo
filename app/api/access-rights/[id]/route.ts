import { NextResponse } from "next/server"

import { AccessRightError, deleteAccessRight, updateAccessRight } from "@/lib/access-rights-repo"
import { accessRightErrorResponse, accessRightSchema } from "@/app/api/access-rights/schema"
import { parseBody, parseId } from "@/lib/auth-request"
import { requireRole } from "@/lib/rbac"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Права доступа не найдены" }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, accessRightSchema)
  if (parsed.error) return parsed.error

  try {
    const accessRight = await updateAccessRight(id, { name: parsed.data.name, capabilityIds: parsed.data.capabilityIds ?? [] })
    if (!accessRight) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(accessRight)
  } catch (error) {
    if (error instanceof AccessRightError) return accessRightErrorResponse(error)
    throw error
  }
}

// DELETE /api/access-rights/[id] — 409 {error, usage} while users or dashboard
// widgets are linked to it.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const ok = await deleteAccessRight(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AccessRightError) return accessRightErrorResponse(error)
    throw error
  }
}
