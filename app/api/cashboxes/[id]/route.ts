import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { cashboxErrorResponse, deleteCashbox, getCashboxDetail, updateCashbox } from "@/lib/cashboxes-repo"
import { cashboxInputSchema, parseCashboxId } from "@/lib/cashboxes-schema"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Касса не найдена" }

// GET /api/cashboxes/[id] — demo GET finance/cashbox/:id/; ?usage=1 adds where it is used.
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseCashboxId((await params).id)
  const withUsage = new URL(request.url).searchParams.get("usage") === "1"
  const cashbox = id ? await getCashboxDetail(id, withUsage) : null
  if (!cashbox) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(cashbox)
}

// PUT /api/cashboxes/[id] — a rename is carried over to the legacy `kassa` copies of the payments.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseCashboxId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, cashboxInputSchema)
  if (parsed.error) return parsed.error

  try {
    const cashbox = await updateCashbox(id, parsed.data)
    if (!cashbox) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(cashbox)
  } catch (error) {
    const response = cashboxErrorResponse(error)
    if (response) return response
    throw error
  }
}

// DELETE /api/cashboxes/[id] — 409 {error: "Удаление невозможно из-за связи с другими данными", usage}
// while any operation, payment, transfer, acceptance or cashback request references the cashbox.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseCashboxId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const ok = await deleteCashbox(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const response = cashboxErrorResponse(error)
    if (response) return response
    throw error
  }
}
