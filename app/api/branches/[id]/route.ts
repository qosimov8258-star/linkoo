import { NextResponse } from "next/server"

import { branchErrorResponse, branchSchema } from "@/app/api/branches/schema"
import { parseBody, parseId } from "@/lib/auth-request"
import { deleteBranch, getBranch, updateBranch } from "@/lib/branches-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Филиал не найден" }

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseId((await params).id)
  const branch = id ? await getBranch(id) : null
  if (!branch) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(branch)
}

// PUT /api/branches/[id] — omitted fields keep their value; a new name is carried
// into warehouses, cashboxes, employees, suppliers, clients and documents.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, branchSchema)
  if (parsed.error) return parsed.error

  try {
    const branch = await updateBranch(id, parsed.data)
    if (!branch) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(branch)
  } catch (error) {
    const response = branchErrorResponse(error)
    if (response) return response
    throw error
  }
}

// DELETE /api/branches/[id] — 409 {error, usage} while warehouses, cashboxes,
// employees, suppliers, clients or balance entries use the branch; the main
// branch can never be deleted.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const ok = await deleteBranch(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const response = branchErrorResponse(error)
    if (response) return response
    throw error
  }
}
