import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createWorkShift, listWorkShifts } from "@/lib/work-shifts-repo"
import { workShiftSchema } from "@/lib/work-shifts-schema"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listWorkShifts())
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, workShiftSchema)
  if (parsed.error) return parsed.error

  return NextResponse.json(await createWorkShift(parsed.data), { status: 201 })
}
