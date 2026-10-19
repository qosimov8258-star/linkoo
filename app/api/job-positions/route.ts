import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createJobPosition, listJobPositions } from "@/lib/job-positions-repo"

const jobPositionSchema = z.object({
  name: z.string().trim().min(1),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listJobPositions()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, jobPositionSchema)
  if (parsed.error) return parsed.error

  const position = (await createJobPosition(parsed.data))
  return NextResponse.json(position, { status: 201 })
}
