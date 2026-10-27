import { NextResponse } from "next/server"

import { setDaysSchema } from "@/lib/attendance-api"
import { attendanceErrorResponse } from "@/lib/attendance-errors"
import { setDays } from "@/lib/attendance-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// Изменить: POST {employeeIds, date, type, time?, comment?} sets one day (not after today) of
// the ticked active employees (manager + settings.manage). Перерасчет never overwrites it.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, setDaysSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await setDays({ ...parsed.data, actor: auth.user.displayName }))
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}
