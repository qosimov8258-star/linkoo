import { NextResponse } from "next/server"

import { importSchema } from "@/lib/attendance-api"
import { attendanceErrorResponse } from "@/lib/attendance-errors"
import { importMonth } from "@/lib/attendance-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// Обновить с excel: POST {year, month, rows} — the parsed sheet of the template (first row =
// header with "DD.MM.YYYY" date columns, first column = employee). All-or-nothing: any bad row
// answers 400 {error: "Ошибки в файле", errors: [{row, column, error, value}]} and nothing is saved.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, importSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await importMonth({ ...parsed.data, actor: auth.user.displayName }))
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}
