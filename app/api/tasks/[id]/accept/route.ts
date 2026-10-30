import { NextResponse } from "next/server"

import { fieldWriteScope } from "@/lib/field-activity/actor"
import { requireRole } from "@/lib/rbac"
import { acceptTask, taskErrorResponse } from "@/lib/tasks-repo"
import { invalidIdResponse, parseIdSegment } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/tasks/[id]/accept — "Принять": a done task becomes finished (409 for any other status,
// so a double click accepts once). Manager + clients.manage; a task outside the writer's field scope
// (lib/field-activity/actor.ts) answers 404.
export async function POST(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const access = await fieldWriteScope(auth.user)
  if (access.error) return access.error
  try {
    return NextResponse.json(await acceptTask(id, access.scope))
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}
