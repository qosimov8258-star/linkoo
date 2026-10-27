import { NextResponse } from "next/server"
import { z } from "zod"

import { nameField, parseBody } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { createJobPosition, JobPositionError, listJobPositions } from "@/lib/job-positions-repo"
import { requireRole } from "@/lib/rbac"

const jobPositionSchema = z.object({ name: nameField("Укажите название должности", 120) })

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listJobPositions())
}

// POST /api/job-positions {name} — 409 when the name exists (case- and space-insensitive).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseBody(request, jobPositionSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createJobPosition(parsed.data), { status: 201 })
  } catch (error) {
    if (error instanceof JobPositionError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
