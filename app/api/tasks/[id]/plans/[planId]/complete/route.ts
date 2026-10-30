import { NextResponse } from "next/server"

import { fieldWriteScope } from "@/lib/field-activity/actor"
import { requireRole } from "@/lib/rbac"
import { completeTaskPlan, taskErrorResponse, taskPlanCompleteSchema } from "@/lib/tasks-repo"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string; planId: string }> }

// Agent app API (the clone has no mobile app; this is the call it would make):
// POST /api/tasks/[id]/plans/[planId]/complete {status: "done" | "undone", response?: text ≤ 1000,
//   photo?: "data:image/(png|jpeg|webp|gif);base64,…" ≤ 3 MB}
// → the task with its plans. Only the account linked to the task's responsible employee
// (users.employee_id) or an administrator may call it (403); the plan must still be pending (409)
// and the task not finished (409). When no plan is pending any more and one is done, the task
// becomes "Выполнено". Role manager + clients.manage (the "Savdo agenti" access right has it). A task
// outside the caller's field scope (lib/field-activity/actor.ts) answers 404 like a missing one.
export async function POST(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const segments = await params
  const id = parseIdSegment(segments.id)
  const planId = parseIdSegment(segments.planId)
  if (id === null || planId === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, taskPlanCompleteSchema)
  if (parsed.error) return parsed.error
  const access = await fieldWriteScope(auth.user)
  if (access.error) return access.error

  try {
    return NextResponse.json(await completeTaskPlan(id, planId, parsed.data, auth.user, access.scope))
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}
