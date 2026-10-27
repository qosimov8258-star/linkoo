import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { acceptTask, taskErrorResponse } from "@/lib/tasks-repo"
import { invalidIdResponse, parseIdSegment } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/tasks/[id]/accept — "Принять": a done task becomes finished (409 for any other status,
// so a double click accepts once). Manager + clients.manage.
export async function POST(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  try {
    return NextResponse.json(await acceptTask(id))
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}
