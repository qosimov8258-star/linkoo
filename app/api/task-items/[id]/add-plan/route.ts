import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { addTaskItemPlan } from "@/lib/task-items-repo"
import { parseJsonBody } from "@/lib/validation"

const schema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), comment: z.string().optional() })

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const item = await addTaskItemPlan(Number((await params).id), parsed.data.date ?? null, parsed.data.comment ?? "")
  return item ? NextResponse.json(item) : NextResponse.json({ error: "Задача не найдена" }, { status: 404 })
}
