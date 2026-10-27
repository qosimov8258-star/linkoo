import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { createTask, listTasks, parseTaskListQuery, taskCreateSchema, taskErrorResponse } from "@/lib/tasks-repo"
import { invalidFieldResponse, notSignedInResponse, parseJsonBody } from "@/lib/validation"

// GET /api/tasks?status=in_progress|done|finished&search=&page=1&pageSize=25&responsible=1,2
//   &createdBy=3&client=4,5&createdFrom=YYYY-MM-DD&createdTo=&taskFrom=&taskTo=&branch=<id>
// → {count, page, pageSize, results: [{id, title, clientId, client, responsibleId, responsible,
//    createdById, createdBy, status, taskDate, createdAt}]}, newest first. Any signed-in user.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseTaskListQuery(new URL(request.url).searchParams)
  if ("error" in parsed) return invalidFieldResponse(parsed.field, parsed.error, parsed.error)
  try {
    return NextResponse.json(await listTasks(parsed.query))
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}

// POST /api/tasks {title, clientId, employeeId, taskDate: YYYY-MM-DD, repeat?: {frequency: 7|14, count: 1..52}}
// → 201 the task with its plans (plan #1 on taskDate, then every `frequency` days, `count` plans in
// all). The client must exist and the employee must exist and be active (400). Manager + clients.manage.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, taskCreateSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createTask(parsed.data, auth.user), { status: 201 })
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}
