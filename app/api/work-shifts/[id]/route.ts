import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { deleteWorkShift, getWorkShift, updateWorkShift } from "@/lib/work-shifts-repo"
import { workShiftSchema } from "@/lib/work-shifts-schema"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("viewer")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()

  const shift = await getWorkShift(id)
  if (!shift) return NextResponse.json({ error: "Смена не найдена" }, { status: 404 })
  return NextResponse.json(shift)
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()

  const parsed = await parseJsonBody(request, workShiftSchema)
  if (parsed.error) return parsed.error

  const shift = await updateWorkShift(id, parsed.data)
  if (!shift) return NextResponse.json({ error: "Смена не найдена" }, { status: 404 })
  return NextResponse.json(shift)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()

  if (!(await deleteWorkShift(id))) return NextResponse.json({ error: "Смена не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
