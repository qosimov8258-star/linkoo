import { NextResponse } from "next/server"

import { deleteIndividualRate, getIndividualRate, updateIndividualRate } from "@/lib/currency-rates-repo"
import { individualRateSchema } from "@/lib/currency-rates-schema"
import { dbErrorResponse } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// The id segment is a plain positive int4 (parseIdSegment): "0x2", "2e0", "2.0" or " 2" never resolve to row 2.
const NOT_FOUND = { error: "Индивидуальный курс не найден" }

export async function GET(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("viewer")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  const item = id === null ? null : await getIndividualRate(id)
  if (!item) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(item)
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseJsonBody(request, individualRateSchema)
  if (parsed.error) return parsed.error

  try {
    const item = await updateIndividualRate(id, parsed.data)
    if (!item) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(item)
  } catch (error) {
    const response = dbErrorResponse(error)
    if (response) return response
    throw error
  }
}

/** Валюты → "Индивидуальный": removes a wrong entry (settings.manage, lib/capabilities-catalog.ts). */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    if (!(await deleteIndividualRate(id))) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const response = dbErrorResponse(error)
    if (response) return response
    throw error
  }
}
