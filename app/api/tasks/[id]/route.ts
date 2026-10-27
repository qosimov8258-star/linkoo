import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { TASK_NOT_FOUND, deleteTask, getTaskDetail, taskErrorResponse, taskUpdateSchema, updateTask } from "@/lib/tasks-repo"
import { invalidIdResponse, notSignedInResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/tasks/[id] — the task with its plans: {…list fields, plans: [{id, date, comment, status,
// response, photoUrl, doneAt}]}. Any signed-in user.
export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  try {
    const task = await getTaskDetail(id)
    if (!task) return NextResponse.json({ error: TASK_NOT_FOUND }, { status: 404 })
    return NextResponse.json(task)
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}

// PUT /api/tasks/[id] {title, clientId, employeeId, taskDate} — "Изменить задачу" (the plans stay).
// The client must exist; the employee must exist and be active unless the task already has them.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, taskUpdateSchema)
  if (parsed.error) return parsed.error

  try {
    const task = await updateTask(id, parsed.data)
    if (!task) return NextResponse.json({ error: TASK_NOT_FOUND }, { status: 404 })
    return NextResponse.json(task)
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}

// DELETE /api/tasks/[id] — the task and its plans (no button in the UI, as in the reference app).
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  try {
    const ok = await deleteTask(id)
    if (!ok) return NextResponse.json({ error: TASK_NOT_FOUND }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}
