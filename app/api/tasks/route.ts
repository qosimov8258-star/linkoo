import { NextResponse } from "next/server"

import { fieldWriteScope, requireFieldReader } from "@/lib/field-activity/actor"
import { requireRole } from "@/lib/rbac"
import { createTask, listTasks, parseTaskListQuery, taskCreateSchema, taskErrorResponse } from "@/lib/tasks-repo"
import { invalidFieldResponse, parseJsonBody } from "@/lib/validation"

// GET /api/tasks?status=in_progress|done|finished&search=&page=1&pageSize=25&responsible=1,2
//   &createdBy=3&client=4,5&createdFrom=YYYY-MM-DD&createdTo=&taskFrom=&taskTo=&branch=<id>
// → {count, page, pageSize, results: [{id, title, clientId, client, responsibleId, responsible,
//    createdById, createdBy, status, taskDate, createdAt}]}, newest first. The tasks of the reader's
// field scope (lib/field-activity/actor.ts): an agent sees only the tasks they are responsible for
// (and those of the agents they supervise); a user without any field scope gets 403.
export async function GET(request: Request) {
  const reader = await requireFieldReader()
  if (reader.error) return reader.error
  const parsed = parseTaskListQuery(new URL(request.url).searchParams)
  if ("error" in parsed) return invalidFieldResponse(parsed.field, parsed.error, parsed.error)
  try {
    return NextResponse.json(await listTasks(parsed.query, reader.scope))
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}

// POST /api/tasks {title, clientId, employeeId, taskDate: YYYY-MM-DD, repeat?: {frequency: 7|14, count: 1..52}}
// → 201 the task with its plans (plan #1 on taskDate, then every `frequency` days, `count` plans in
// all). The client must exist and the employee must exist, be active and be inside the writer's
// field scope (400). Manager + clients.manage.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, taskCreateSchema)
  if (parsed.error) return parsed.error
  const access = await fieldWriteScope(auth.user)
  if (access.error) return access.error

  try {
    return NextResponse.json(await createTask(parsed.data, auth.user, access.scope), { status: 201 })
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}
