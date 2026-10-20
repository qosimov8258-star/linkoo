import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createTask, listTasks, parseTaskInput } from "@/lib/tasks-repo"

const taskSchema = z.object({
  responsible: z.string().trim().min(1).max(255, "Не более 255 символов"),
  store: z.string().trim().min(1).max(255, "Не более 255 символов"),
  description: z.string().optional(),
  status: z.enum(["in_progress", "fulfilled", "closed"]).optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listTasks()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, taskSchema)
  if (parsed.error) return parsed.error

  const input = parseTaskInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Ответственный и магазин обязательны" }, { status: 400 })

  const task = (await createTask(input))
  return NextResponse.json(task, { status: 201 })
}
