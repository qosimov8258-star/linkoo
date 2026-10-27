import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { branchExists, deleteTransport, getTransport, updateTransport } from "@/lib/transport-repo"
import { transportSchema } from "@/lib/transport-schema"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("viewer")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const item = await getTransport(id)
  if (!item) return NextResponse.json({ error: "Транспорт не найден" }, { status: 404 })
  return NextResponse.json(item)
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, transportSchema)
  if (parsed.error) return parsed.error
  if (parsed.data.branchId !== null && !(await branchExists(parsed.data.branchId))) {
    return NextResponse.json({ error: "Филиал не найден" }, { status: 400 })
  }

  const item = await updateTransport(id, parsed.data)
  if (!item) return NextResponse.json({ error: "Транспорт не найден" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  if (!(await deleteTransport(id))) return NextResponse.json({ error: "Транспорт не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
