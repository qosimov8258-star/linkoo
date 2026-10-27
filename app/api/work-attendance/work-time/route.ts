import { NextResponse } from "next/server"

import { workTimeSchema } from "@/lib/attendance-api"
import { attendanceErrorResponse } from "@/lib/attendance-errors"
import { getLateAfter, setLateAfter } from "@/lib/attendance-settings-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

// Рабочее время: GET → {late: "HH:MM"} ("Считать опозданием после"); PUT {late} saves it
// (manager + settings.manage). A new value applies to days derived from now on and to Перерасчет.

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  try {
    return NextResponse.json({ late: await getLateAfter() })
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}

export async function PUT(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, workTimeSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json({ late: await setLateAfter(parsed.data.late, auth.user.displayName) })
  } catch (error) {
    const response = attendanceErrorResponse(error)
    if (response) return response
    throw error
  }
}
