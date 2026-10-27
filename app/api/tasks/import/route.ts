import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { importTasks, taskErrorResponse, taskImportSchema } from "@/lib/tasks-repo"
import { parseJsonBody } from "@/lib/validation"

// POST /api/tasks/import {rows: [{line?, title, client, responsible, taskDate, status?}]} (≤ 2000 rows)
// → 201 {created}. Client / employee by id, else by exact name (exactly one); the date as typed in
// the sheet (YYYY-MM-DD, DD.MM.YYYY, …). All rows or none: a bad row answers 400 {error, field, row}.
// Manager + clients.manage.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, taskImportSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await importTasks(parsed.data, auth.user), { status: 201 })
  } catch (error) {
    const response = taskErrorResponse(error)
    if (response) return response
    throw error
  }
}
