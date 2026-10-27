import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { deleteTask, parseTaskInput, updateTask } from "@/lib/tasks-repo"

const taskSchema = z.object({
  responsible: z.string().trim().min(1).max(255, "Не более 255 символов"),
  store: z.string().trim().min(1).max(255, "Не более 255 символов"),
  description: z.string().optional(),
  status: z.enum(["in_progress", "fulfilled", "closed"]).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, taskSchema)
  if (parsed.error) return parsed.error

  const input = parseTaskInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Ответственный и магазин обязательны" }, { status: 400 })

  const task = (await updateTask(id, input))
  if (!task) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 })
  return NextResponse.json(task)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const ok = (await deleteTask(id))
  if (!ok) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
