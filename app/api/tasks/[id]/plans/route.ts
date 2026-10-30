import { NextResponse } from "next/server"

import { fieldWriteScope } from "@/lib/field-activity/actor"
import { requireRole } from "@/lib/rbac"
import { addTaskPlan, taskErrorResponse, taskPlanSchema } from "@/lib/tasks-repo"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/tasks/[id]/plans {date: YYYY-MM-DD, comment?} — "Добавить план" → 201 the task with its
// plans. A done task goes back to "В процессе"; a finished one is refused (409). Manager + clients.manage;
// a task outside the writer's field scope (lib/field-activity/actor.ts) answers 404.
export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, taskPlanSchema)
  if (parsed.error) return parsed.error
  const access = await fieldWriteScope(auth.user)
  if (access.error) return access.error

  try {
    return NextResponse.json(await addTaskPlan(id, parsed.data, auth.user, access.scope), { status: 201 })
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}
