import { NextResponse } from "next/server"

import { dbErrorResponse } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { deleteWorkShift, getWorkShift, updateWorkShift, WorkShiftInUseError } from "@/lib/work-shifts-repo"
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

  let shift: Awaited<ReturnType<typeof updateWorkShift>>
  try {
    shift = await updateWorkShift(id, parsed.data)
  } catch (error) {
    // A rename cascades into the shift entries of Производство → Активность: a lock wait or a deadlock there is
    // answered as JSON, as DELETE does.
    const busy = dbErrorResponse(error)
    if (busy) return busy
    throw error
  }
  if (!shift) return NextResponse.json({ error: "Смена не найдена" }, { status: 404 })
  return NextResponse.json(shift)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()

  try {
    if (!(await deleteWorkShift(id))) return NextResponse.json({ error: "Смена не найдена" }, { status: 404 })
  } catch (error) {
    // A shift production staff rows hold stays: 409 with where it is used.
    if (error instanceof WorkShiftInUseError) return NextResponse.json({ error: error.message, usage: error.usage }, { status: error.status })
    const busy = dbErrorResponse(error)
    if (busy) return busy
    throw error
  }
  return NextResponse.json({ ok: true })
}
