import { NextResponse } from "next/server"

import { yearMonthSchema } from "@/lib/attendance-api"
import { attendanceErrorResponse } from "@/lib/attendance-errors"
import { recalcMonth } from "@/lib/attendance-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// Перерасчет: POST {year, month} rebuilds the month's derived days from the activity, the
// current work time and the holidays (manager + settings.manage); manual days stay.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, yearMonthSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json({ ...parsed.data, ...(await recalcMonth(parsed.data)) })
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}
