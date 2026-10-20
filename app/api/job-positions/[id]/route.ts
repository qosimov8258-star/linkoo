import { NextResponse } from "next/server"
import { z } from "zod"

import { nameField, parseBody, parseId } from "@/lib/auth-request"
import { deleteJobPosition, JobPositionError, updateJobPosition } from "@/lib/job-positions-repo"
import { requireRole } from "@/lib/rbac"

const jobPositionSchema = z.object({ name: nameField("Укажите название должности", 120) })

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Должность не найдена" }

function errorResponse(error: JobPositionError) {
  return NextResponse.json({ error: error.message, ...(error.usage ? { usage: error.usage } : {}) }, { status: error.status })
}

// PUT /api/job-positions/[id] {name} — 409 for a name taken by another position;
// employees with the old name follow the rename.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, jobPositionSchema)
  if (parsed.error) return parsed.error

  try {
    const position = await updateJobPosition(id, parsed.data)
    if (!position) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(position)
  } catch (error) {
    if (error instanceof JobPositionError) return errorResponse(error)
    throw error
  }
}

// DELETE /api/job-positions/[id] — 409 {error, usage} while employees hold the position.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const ok = await deleteJobPosition(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof JobPositionError) return errorResponse(error)
    throw error
  }
}
