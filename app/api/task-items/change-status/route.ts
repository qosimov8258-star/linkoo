import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { changeTaskItemStatus } from "@/lib/task-items-repo"
import { parseJsonBody } from "@/lib/validation"

const schema = z.object({ task: z.number().int(), status: z.enum(["new", "in_progress", "done", "finished"]) })

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const item = await changeTaskItemStatus(parsed.data.task, parsed.data.status)
  return item ? NextResponse.json(item) : NextResponse.json({ error: "Задача не найдена" }, { status: 404 })
}
