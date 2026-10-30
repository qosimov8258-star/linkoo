import { NextResponse } from "next/server"

import { fieldWriteScope } from "@/lib/field-activity/actor"
import { requireRole } from "@/lib/rbac"
import { importTasks, taskErrorResponse, taskImportSchema } from "@/lib/tasks-repo"
import { parseJsonBody } from "@/lib/validation"

// POST /api/tasks/import {rows: [{line?, title, client, responsible, taskDate, status?}]} (≤ 2000 rows)
// → 201 {created}. Client / employee by id, else by exact name (exactly one); the date as typed in
// the sheet (YYYY-MM-DD, DD.MM.YYYY, …). All rows or none: a bad row answers 400 {error, field, row}.
// Manager + clients.manage; a responsible employee outside the writer's field scope
// (lib/field-activity/actor.ts) is refused like an unknown one.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, taskImportSchema)
  if (parsed.error) return parsed.error
  const access = await fieldWriteScope(auth.user)
  if (access.error) return access.error

  try {
    return NextResponse.json(await importTasks(parsed.data, auth.user, access.scope), { status: 201 })
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}
