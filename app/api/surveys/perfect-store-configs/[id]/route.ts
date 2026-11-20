import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import {
  deletePerfectStoreConfig,
  getPerfectStoreConfig,
  perfectStoreConfigBody,
  perfectStoreConfigErrorResponse,
  updatePerfectStoreConfig,
} from "@/lib/perfect-store-configs-repo"
import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, notSignedInResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = "Не найдено"

// GET / PUT / DELETE /api/surveys/perfect-store-configs/[id] — one Perfect Store Config: read, replace (same body and
// checks as POST), delete. 404 for an unknown id.
export async function GET(_request: Request, { params }: RouteParams) {
  if (!(await getCurrentUser())) return notSignedInResponse()
  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const config = await getPerfectStoreConfig(id)
  return config ? NextResponse.json(config) : NextResponse.json({ error: NOT_FOUND }, { status: 404 })
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, perfectStoreConfigBody)
  if (parsed.error) return parsed.error
  try {
    const config = await updatePerfectStoreConfig(id, parsed.data)
    return config ? NextResponse.json(config) : NextResponse.json({ error: NOT_FOUND }, { status: 404 })
  } catch (error) {
    const response = perfectStoreConfigErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  if (!(await deletePerfectStoreConfig(id))) return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
  return NextResponse.json({ ok: true })
}
