import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { getTaskItem, updateTaskItem } from "@/lib/task-items-repo"
import { parseJsonBody } from "@/lib/validation"
import { z } from "zod"

type Params = { params: Promise<{ id: string }> }

export async function GET(_r: Request, { params }: Params) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const item = await getTaskItem(Number((await params).id))
  return item ? NextResponse.json(item) : NextResponse.json({ error: "Задача не найдена" }, { status: 404 })
}

const schema = z.object({ title: z.string().trim().min(1), market: z.number().int(), responsibleUser: z.number().int(), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

export async function PUT(request: Request, { params }: Params) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const item = await updateTaskItem(Number((await params).id), parsed.data)
  return item ? NextResponse.json(item) : NextResponse.json({ error: "Задача не найдена" }, { status: 404 })
}
