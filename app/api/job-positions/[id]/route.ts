import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteJobPosition, updateJobPosition } from "@/lib/job-positions-repo"

const jobPositionSchema = z.object({
  name: z.string().trim().min(1),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, jobPositionSchema)
  if (parsed.error) return parsed.error

  const position = (await updateJobPosition(id, parsed.data))
  if (!position) return NextResponse.json({ error: "Должность не найдена" }, { status: 404 })
  return NextResponse.json(position)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteJobPosition(id))
  if (!ok) return NextResponse.json({ error: "Должность не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
